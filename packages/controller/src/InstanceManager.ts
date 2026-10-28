import { isDeepStrictEqual } from "node:util";
import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

import type Controller from "./Controller.js";
import type HostConnection from "./HostConnection.js";
import InstanceRecord from "./InstanceRecord.js";

export default class InstanceManager {
	private static readonly DefaultFactorioSettings = {
		tags: ["clusterio"],
		max_players: 0,
		visibility: { public: true, lan: true },
		game_password: "",
		require_user_verification: true,
		max_upload_in_kilobytes_per_second: 0,
		max_upload_slots: 5,
		ignore_player_limit_for_returning_players: false,
		allow_commands: "admins-only",
		autosave_interval: 10,
		autosave_slots: 5,
		afk_autokick_interval: 0,
		auto_pause: false,
		only_admins_can_pause_the_game: true,
		autosave_only_on_server: true,
		non_blocking_saving: false,
	} as const;

	/** Non-zero while base values are being copied into inheriting instances */
	private _inheriting = 0;

	constructor(
		public readonly records: lib.SubscribableDatastore<InstanceRecord>,
		private readonly _controller: Controller,
	) {
		for (const instance of records.values()) {
			this.addInstanceHooks(instance);
		}
	}

	/* ------------------------------------------------------------------------- */
	/* Basic Accessors                                                           */
	/* ------------------------------------------------------------------------- */

	has(id: InstanceRecord["id"]): boolean {
		return this.records.has(id);
	}

	getMutable(id: InstanceRecord["id"]): InstanceRecord | undefined {
		return this.records.get(id);
	}

	get(id: InstanceRecord["id"]): Readonly<InstanceRecord> | undefined {
		return this.getMutable(id);
	}

	valuesMutable(): IterableIterator<InstanceRecord> {
		return this.records.values();
	}

	values(): IterableIterator<Readonly<InstanceRecord>> {
		return this.valuesMutable();
	}

	/**
	 * Get instance by ID for a request.
	 *
	 * Convenience wrapper around {@link getMutable} that throws
	 * if the instance does not exist.
	 *
	 * @param instanceId - ID of instance to get.
	 * @returns The instance record.
	 * @throws {module:lib.NotFoundError} if the instance does not exist.
	 */
	getForRequest(instanceId: number): InstanceRecord {
		const instance = this.records.get(instanceId);
		if (!instance) {
			throw new lib.NotFoundError(`Instance with ID ${instanceId} does not exist`);
		}
		return instance;
	}

	/* ------------------------------------------------------------------------- */
	/* Internal Helpers                                                          */
	/* ------------------------------------------------------------------------- */

	private async _notifyStatusChanged(
		instance: InstanceRecord,
		prev?: lib.InstanceStatus,
	): Promise<void> {
		await this._controller.hooks.instanceStatusChanged.invoke(instance, prev);
	}

	private async _notifyConfigFieldChanged(
		instance: InstanceRecord,
		field: string,
		curr: unknown,
		prev: unknown,
	): Promise<void> {
		await this._controller.hooks.instanceConfigFieldChanged.invoke(instance, field, curr, prev);
	}

	/**
	 * Attach change listeners to an instance record.
	 *
	 * Hooks into configuration field changes and ensures the datastore
	 * is updated and plugins are notified when a config field changes.
	 *
	 * @param instance - The instance record to attach hooks to.
	 * @internal
	 */
	addInstanceHooks(instance: InstanceRecord): void {
		instance.config.on("fieldChanged", (field: string, curr: unknown, prev: unknown) => {
			if (field === "instance.base_id") {
				this._rebase(instance);
			} else if (!this._inheriting && instance.config.isInherited(field)) {
				this._setInherited(instance, [field], false);
			}
			this.records.set(instance);
			this._notifyConfigFieldChanged(instance, field, curr, prev);
			this._propagate(instance, field, curr);
		});
	}

	/* ------------------------------------------------------------------------- */
	/* Inheritance                                                               */
	/* ------------------------------------------------------------------------- */

	/**
	 * Get the instances that inherit directly from the given base.
	 *
	 * @param baseId - ID of the base instance.
	 * @returns Instances with `instance.base_id` set to baseId.
	 */
	inheritorsOf(baseId: number): InstanceRecord[] {
		return [...this.records.values()].filter(
			instance => instance.config.get("instance.base_id") === baseId
		);
	}

	/**
	 * Check that new values for `instance.is_base` and `instance.base_id` are allowed.
	 *
	 * @param config - Current config of the instance.
	 * @param isBase - New value for `instance.is_base`.
	 * @param baseId - New value for `instance.base_id`.
	 * @throws {module:lib.ValidationError} if the base is not a base or would create a cycle.
	 * @throws {module:lib.ConflictError} if the instance is assigned or still has inheritors.
	 */
	checkInheritance(config: lib.InstanceConfig, isBase: boolean, baseId: number | null): void {
		const instanceId = config.get("instance.id");
		if (isBase && config.get("instance.assigned_host") !== null) {
			throw new lib.ConflictError("Instance must be unassigned before it can be made a base");
		}
		if (!isBase && config.get("instance.is_base")) {
			const count = this.inheritorsOf(instanceId).length;
			if (count) {
				throw new lib.ConflictError(`Instance is the base of ${count} other instance(s)`);
			}
		}
		if (baseId === null) {
			return;
		}
		const base = this.records.get(baseId);
		if (!base) {
			throw new lib.NotFoundError(`Instance with ID ${baseId} does not exist`);
		}
		if (!base.config.get("instance.is_base")) {
			throw new lib.ValidationError(`Instance ${base.config.get("instance.name")} is not a base`);
		}
		const visited = new Set<number>();
		for (let id: number | null = baseId; id !== null && !visited.has(id);) {
			if (id === instanceId) {
				throw new lib.ValidationError("Base instances cannot inherit from themselves");
			}
			visited.add(id);
			id = this.records.get(id)?.config.get("instance.base_id") ?? null;
		}
	}

	/**
	 * Copy all inheritable values from the base set in `instance.base_id`
	 * into a config that is not yet part of the cluster and mark them inherited.
	 *
	 * @param config - Config of the instance to be created.
	 * @param keep - Fields to keep the current value of.
	 */
	applyBase(config: lib.InstanceConfig, keep: string[] = []): void {
		const base = this.records.get(config.get("instance.base_id")!);
		if (!base) {
			return;
		}
		const values: Record<string, any> = {};
		const inherited: Record<string, true> = {};
		for (const name of Object.keys(lib.InstanceConfig.fieldDefinitions)) {
			if (lib.InstanceConfig.isInheritable(name) && !keep.includes(name)) {
				values[name] = structuredClone(base.config.get(name as keyof lib.InstanceConfigFields));
				inherited[name] = true;
			}
		}
		config.update(values, false);
		config.set("instance.inherited_fields", inherited);
	}

	/**
	 * Make a field take its value from the base instance again.
	 *
	 * @param instanceId - ID of the instance to update.
	 * @param field - Name of the field to inherit.
	 * @throws {module:lib.ValidationError} if the instance has no base or the field cannot be inherited.
	 */
	inheritField(instanceId: number, field: string): void {
		const instance = this.getForRequest(instanceId);
		const baseId = instance.config.get("instance.base_id");
		const base = baseId !== null ? this.records.get(baseId) : undefined;
		if (!base) {
			throw new lib.ValidationError("Instance does not have a base");
		}
		if (!lib.InstanceConfig.isInheritable(field)) {
			throw new lib.ValidationError(`Field ${field} cannot be inherited`);
		}
		this._setInherited(instance, [field], true);
		this._inheriting += 1;
		try {
			instance.config.update({
				[field]: structuredClone(base.config.get(field as keyof lib.InstanceConfigFields)),
			}, true);
		} finally {
			this._inheriting -= 1;
		}
	}

	/**
	 * Stop inheriting the given fields, used when a value is explicitly set.
	 *
	 * @param instance - Instance the fields were set on.
	 * @param fields - Names of fields set.
	 */
	overrideFields(instance: InstanceRecord, fields: string[]): void {
		const inherited = fields.filter(field => instance.config.isInherited(field));
		if (inherited.length) {
			this._setInherited(instance, inherited, false);
		}
	}

	private _setInherited(instance: InstanceRecord, fields: string[], inherited: boolean): void {
		const value = { ...instance.config.get("instance.inherited_fields") };
		for (const field of fields) {
			if (inherited) {
				value[field] = true;
			} else {
				delete value[field];
			}
		}
		instance.config.set("instance.inherited_fields", value);
	}

	/** Recompute inherited fields after base_id changed, values equal to the base are inherited */
	private _rebase(instance: InstanceRecord): void {
		const baseId = instance.config.get("instance.base_id");
		const base = baseId !== null ? this.records.get(baseId) : undefined;
		const inherited: Record<string, true> = {};
		if (base) {
			for (const name of Object.keys(lib.InstanceConfig.fieldDefinitions)) {
				const field = name as keyof lib.InstanceConfigFields;
				if (
					lib.InstanceConfig.isInheritable(name)
					&& isDeepStrictEqual(instance.config.get(field), base.config.get(field))
				) {
					inherited[name] = true;
				}
			}
		}
		instance.config.set("instance.inherited_fields", inherited);
	}

	/** Copy a changed value from a base to the instances inheriting it */
	private _propagate(base: InstanceRecord, field: string, value: unknown): void {
		if (!lib.InstanceConfig.isInheritable(field)) {
			return;
		}
		for (const instance of this.inheritorsOf(base.id)) {
			if (!instance.config.isInherited(field)) {
				continue;
			}
			this._inheriting += 1;
			try {
				instance.config.update({ [field]: structuredClone(value) as any }, true);
			} finally {
				this._inheriting -= 1;
			}
			this._controller.instanceConfigUpdated(instance).catch(err => {
				logger.error(`Failed to send config of instance ${instance.id} to its host:\n${err.stack}`);
			});
		}
	}

	/* ------------------------------------------------------------------------- */
	/* Lifecycle                                                                 */
	/* ------------------------------------------------------------------------- */

	/**
	 * Create a new instance.
	 *
	 * @example
	 * const config = new lib.InstanceConfig("controller", { "instance.name": "My instance" });
	 * const instance = await controller.instances.createInstance(config);
	 *
	 * @param instanceConfig - Config to base the newly created instance on.
	 * @param _suppressChanges - When true, side effects are suppressed, caller takes ownership.
	 * @returns The created instance record.
	 * @throws {module:lib.ConflictError} if an instance with the same ID already exists.
	 */
	async createInstance(
		instanceConfig: lib.InstanceConfig,
		_suppressChanges?: boolean,
	): Promise<InstanceRecord> {
		const instanceId = instanceConfig.get("instance.id");
		if (this.records.has(instanceId)) {
			throw new lib.ConflictError(`Instance with ID ${instanceId} already exists`);
		}

		if (!instanceConfig.isInherited("factorio.settings")) {
			const controllerName = this._controller.config.get("controller.name");
			instanceConfig.set("factorio.settings", {
				name: `${controllerName} - ${instanceConfig.get("instance.name")}`,
				description: `Clusterio instance for ${controllerName}`,
				...InstanceManager.DefaultFactorioSettings,
				...instanceConfig.get("factorio.settings"),
			});
		}

		const instance = new InstanceRecord(instanceConfig, "unassigned");
		this.addInstanceHooks(instance);

		if (!_suppressChanges) {
			this.records.set(instance);
			await this._notifyStatusChanged(instance);
		}

		return instance;
	}

	/**
	 * Change the assigned host of an instance.
	 *
	 * Unassigns the instance from the currently assigned host (if connected)
	 * and assigns it to the provided host.
	 *
	 * This is the only supported way of modifying the
	 * `instance.assigned_host` configuration entry.
	 *
	 * Note:
	 * - This does NOT transfer any files or saves between hosts.
	 * - If the instance is already assigned to the specified host, no action is taken.
	 *
	 * @param instanceId - ID of instance to assign.
	 * @param hostId - ID of host to assign the instance to. If undefined,
	 * the instance will be unassigned.
	 *
	 * @throws {module:lib.NotFoundError} if the instance does not exist.
	 * @throws {module:lib.UnavailableError} if the target host is not connected.
	 */
	async assignInstance(
		instanceId: number,
		hostId: number | null,
	): Promise<void> {
		const instance = this.getForRequest(instanceId);
		const hostConnections = this._controller.wsServer.hostConnections;

		const currentAssignedHost = instance.config.get("instance.assigned_host");
		if (currentAssignedHost === hostId) {
			return;
		}
		if (hostId !== null && instance.config.get("instance.is_base")) {
			throw new lib.ValidationError("Base instances cannot be assigned to a host");
		}

		let newHostConnection: HostConnection | undefined;
		if (hostId !== null) {
			newHostConnection = hostConnections.get(hostId);
			if (!newHostConnection) {
				throw new lib.UnavailableError("Target host is not connected to the controller");
			}
		}

		if (currentAssignedHost !== null) {
			const oldHostConnection = hostConnections.get(currentAssignedHost);
			if (oldHostConnection && !oldHostConnection.connector.closing) {
				await oldHostConnection.send(
					new lib.InstanceUnassignInternalRequest(instanceId),
				);
			}
		}

		this._controller.clearSavesOfInstance(instanceId);
		instance.config.set("instance.assigned_host", hostId);

		if (newHostConnection) {
			try {
				await newHostConnection.send(
					new lib.InstanceAssignInternalRequest(instanceId, instance.config.toRemote("host")),
				);
			} catch (err) {
				// Leave unassigned so the assign can be retried
				instance.config.set("instance.assigned_host", null);
				instance.status = "unassigned";
				this.records.set(instance);
				throw err;
			}
		} else {
			instance.status = "unassigned";
		}

		this.records.set(instance);
	}

	/**
	 * Unassign an instance from its current host.
	 *
	 * Convenience wrapper around {@link assignInstance} that removes
	 * the assigned host.
	 *
	 * @param instanceId - ID of instance to unassign.
	 */
	async unassignInstance(instanceId: number): Promise<void> {
		return this.assignInstance(instanceId, null);
	}

	/**
	 * Delete an instance permanently.
	 *
	 * Sends a delete request to the assigned host (if any),
	 * removes the instance from the datastore,
	 * clears associated saves and user statistics.
	 *
	 * @param instanceId - ID of instance to delete.
	 *
	 * @throws {module:lib.NotFoundError} if the instance does not exist.
	 */
	async deleteInstance(instanceId: number): Promise<void> {
		const instance = this.getForRequest(instanceId);
		const hostId = instance.config.get("instance.assigned_host");
		const inheritors = this.inheritorsOf(instanceId).length;
		if (inheritors) {
			throw new lib.ConflictError(`Instance is the base of ${inheritors} other instance(s)`);
		}

		if (hostId !== null) {
			await this._controller.sendTo(
				{ hostId },
				new lib.InstanceDeleteInternalRequest(instanceId),
			);
		}

		const prevStatus = instance.status;
		this.records.delete(instance);
		this._controller.clearSavesOfInstance(instanceId);
		this._controller.users.clearStatsOfInstance(instanceId);

		await this._notifyStatusChanged(instance, prevStatus);
	}
}
