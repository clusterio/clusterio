import { isDeepStrictEqual } from "node:util";
import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

import type Controller from "./Controller.js";
import type HostConnection from "./HostConnection.js";
import InstanceRecord from "./InstanceRecord.js";

type InheritedFields = lib.InstanceConfigFields["instance.inherited_fields"];
type InheritableField = keyof lib.InstanceConfigFields & string;

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

	/** Non-zero while template values are being copied into inheriting instances */
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
			if (field === "instance.template_id") {
				this._link(instance);
			} else if (!this._inheriting && instance.config.isInherited(field)) {
				this._override(instance, field, curr, prev);
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
	 * Get the instances that inherit directly from the given template.
	 *
	 * @param templateId - ID of the template.
	 * @returns Instances with `instance.template_id` set to templateId.
	 */
	inheritorsOf(templateId: number): InstanceRecord[] {
		return [...this.records.values()].filter(
			instance => instance.config.get("instance.template_id") === templateId
		);
	}

	/**
	 * Check that new values for `instance.is_template` and `instance.template_id` are allowed.
	 *
	 * @param config - Current config of the instance.
	 * @param isTemplate - New value for `instance.is_template`.
	 * @param templateId - New value for `instance.template_id`.
	 * @throws {module:lib.ValidationError} if the template is not a template or would create a cycle.
	 * @throws {module:lib.ConflictError} if the instance is assigned or still has inheritors.
	 */
	checkInheritance(config: lib.InstanceConfig, isTemplate: boolean, templateId: number | null): void {
		const instanceId = config.get("instance.id");
		if (isTemplate && config.get("instance.assigned_host") !== null) {
			throw new lib.ConflictError("Instance must be unassigned before it can be made a template");
		}
		if (!isTemplate && config.get("instance.is_template")) {
			const count = this.inheritorsOf(instanceId).length;
			if (count) {
				throw new lib.ConflictError(`Instance is the template of ${count} other instance(s)`);
			}
		}
		if (templateId === null) {
			return;
		}
		const template = this.records.get(templateId);
		if (!template) {
			throw new lib.NotFoundError(`Instance with ID ${templateId} does not exist`);
		}
		if (!template.config.get("instance.is_template")) {
			throw new lib.ValidationError(`Instance ${template.config.get("instance.name")} is not a template`);
		}
		const visited = new Set<number>();
		for (let id: number | null = templateId; id !== null && !visited.has(id);) {
			if (id === instanceId) {
				throw new lib.ValidationError("Templates cannot inherit from themselves");
			}
			visited.add(id);
			id = this.records.get(id)?.config.get("instance.template_id") ?? null;
		}
	}

	/**
	 * Copy the inheritable values from the template set in `instance.template_id`
	 * into a config that is not yet part of the cluster and mark them inherited.
	 *
	 * @param config - Config of the instance to be created.
	 * @param own - Fields set by the creator, object fields keep their properties as overrides.
	 */
	applyTemplate(config: lib.InstanceConfig, own: string[] = []): void {
		const template = this._templateOf(config);
		if (!template) {
			return;
		}
		const inherited: InheritedFields = {};
		for (const name of InstanceManager._inheritableFields()) {
			const def = lib.InstanceConfig.fieldDefinitions[name];
			if (def.type === "object") {
				inherited[name] = own.includes(name) ? Object.keys(config.get(name) as object ?? {}) : [];
			} else if (!own.includes(name)) {
				inherited[name] = true;
			}
		}
		config.set("instance.inherited_fields", inherited);
		config.update(InstanceManager._resolve(config, template.config, Object.keys(inherited)), false);
	}

	/**
	 * Make a field, or a property of an object field, take its value from the template again.
	 *
	 * @param instanceId - ID of the instance to update.
	 * @param field - Name of the field to inherit.
	 * @param prop - Property of an object field to inherit, inherits all properties if not given.
	 * @throws {module:lib.ValidationError} if the instance has no template or the field cannot be inherited.
	 */
	inheritField(instanceId: number, field: string, prop?: string): void {
		const instance = this.getForRequest(instanceId);
		if (!this._templateOf(instance.config)) {
			throw new lib.ValidationError("Instance does not have a template");
		}
		if (!lib.InstanceConfig.isInheritable(field)) {
			throw new lib.ValidationError(`Field ${field} cannot be inherited`);
		}
		const name = field as InheritableField;
		const inherited = { ...instance.config.get("instance.inherited_fields") };
		if (lib.InstanceConfig.fieldDefinitions[name].type !== "object") {
			inherited[field] = true;
		} else if (prop === undefined) {
			inherited[field] = [];
		} else {
			const entry = inherited[field];
			const overrides = entry instanceof Array ? entry : Object.keys(instance.config.get(name) as object ?? {});
			inherited[field] = overrides.filter(p => p !== prop);
		}
		instance.config.set("instance.inherited_fields", inherited);
		this._resolveInto(instance, [field]);
	}

	/**
	 * Stop inheriting the given field or properties, used when a value is explicitly set.
	 *
	 * @param instance - Instance the field was set on.
	 * @param field - Name of the field set.
	 * @param props - Properties set on an object field.
	 */
	overrideField(instance: InstanceRecord, field: string, props?: string[]): void {
		const entry = instance.config.get("instance.inherited_fields")[field];
		if (!instance.config.isInherited(field)) {
			return;
		}
		const inherited = { ...instance.config.get("instance.inherited_fields") };
		if (entry instanceof Array && props) {
			inherited[field] = [...new Set([...entry, ...props])];
		} else {
			delete inherited[field];
		}
		instance.config.set("instance.inherited_fields", inherited);
	}

	private _templateOf(config: lib.InstanceConfig) {
		const templateId = config.get("instance.template_id");
		return templateId !== null ? this.records.get(templateId) : undefined;
	}

	private static _inheritableFields() {
		return Object.keys(lib.InstanceConfig.fieldDefinitions).filter(
			name => lib.InstanceConfig.isInheritable(name)
		) as InheritableField[];
	}

	/** Default value of a field, or undefined if it is generated */
	private static _defaultValue(name: InheritableField): unknown {
		const def = lib.InstanceConfig.fieldDefinitions[name];
		if (name === "factorio.settings") {
			return InstanceManager.DefaultFactorioSettings;
		}
		return typeof def.initialValue === "function" ? undefined : def.initialValue ?? null;
	}

	/** Values the given inherited fields take from the template, with object overrides applied */
	private static _resolve(config: lib.InstanceConfig, template: lib.InstanceConfig, fields: string[]) {
		const inherited = config.get("instance.inherited_fields");
		const values: Record<string, any> = {};
		for (const field of fields) {
			const name = field as InheritableField;
			const entry = inherited[field];
			if (!entry) {
				continue;
			}
			const value = structuredClone(template.get(name)) as any;
			if (entry instanceof Array) {
				const own = config.get(name) as Record<string, unknown> ?? {};
				for (const prop of entry) {
					if (Object.hasOwn(own, prop)) {
						value[prop] = structuredClone(own[prop]);
					}
				}
			}
			values[field] = value;
		}
		return values;
	}

	/** Update the given inherited fields of a live instance from its template */
	private _resolveInto(instance: InstanceRecord, fields: string[]): void {
		const template = this._templateOf(instance.config);
		if (!template) {
			return;
		}
		const values = InstanceManager._resolve(instance.config, template.config, fields);
		this._inheriting += 1;
		try {
			instance.config.update(values, true);
		} finally {
			this._inheriting -= 1;
		}
	}

	/** Track a change to an inherited field made outside of inheritance */
	private _override(instance: InstanceRecord, field: string, curr: unknown, prev: unknown): void {
		const entry = instance.config.get("instance.inherited_fields")[field];
		if (!(entry instanceof Array)) {
			this.overrideField(instance, field);
			return;
		}
		const currObj = curr as Record<string, unknown> ?? {};
		const prevObj = prev as Record<string, unknown> ?? {};
		const changed = Object.keys(currObj).filter(p => !isDeepStrictEqual(currObj[p], prevObj[p]));
		const removed = Object.keys(prevObj).filter(p => !Object.hasOwn(currObj, p));
		const overrides = [...new Set([...entry, ...changed])].filter(p => !removed.includes(p));
		const inherited = { ...instance.config.get("instance.inherited_fields"), [field]: overrides };
		instance.config.set("instance.inherited_fields", inherited);
		if (removed.length) {
			// Removed properties fall back to the template value
			this._resolveInto(instance, [field]);
		}
	}

	/** Recompute inherited fields after template_id changed, values equal to the template or default are inherited */
	private _link(instance: InstanceRecord): void {
		const template = this._templateOf(instance.config);
		const inherited: InheritedFields = {};
		if (template) {
			for (const name of InstanceManager._inheritableFields()) {
				const value = instance.config.get(name) as any;
				const templateValue = template.config.get(name) as any;
				const defaultValue = InstanceManager._defaultValue(name) as any;
				if (lib.InstanceConfig.fieldDefinitions[name].type === "object") {
					inherited[name] = Object.keys(value ?? {}).filter(prop => !(
						isDeepStrictEqual(value[prop], templateValue?.[prop])
						|| defaultValue && isDeepStrictEqual(value[prop], defaultValue[prop])
					) || name === "factorio.settings" && prop === "name");
				} else if (
					isDeepStrictEqual(value, templateValue)
					|| defaultValue !== undefined && isDeepStrictEqual(value, defaultValue)
				) {
					inherited[name] = true;
				}
			}
		}
		instance.config.set("instance.inherited_fields", inherited);
		this._resolveInto(instance, Object.keys(inherited));
	}

	/** Copy a changed value from a template to the instances inheriting it */
	private _propagate(template: InstanceRecord, field: string, value: unknown): void {
		if (!lib.InstanceConfig.isInheritable(field)) {
			return;
		}
		for (const instance of this.inheritorsOf(template.id)) {
			if (!instance.config.isInherited(field)) {
				continue;
			}
			this._resolveInto(instance, [field]);
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

		const controllerName = this._controller.config.get("controller.name");
		const serverName = `${controllerName} - ${instanceConfig.get("instance.name")}`;
		const settings = instanceConfig.get("factorio.settings");
		if (!instanceConfig.isInherited("factorio.settings")) {
			instanceConfig.set("factorio.settings", {
				name: serverName,
				description: `Clusterio instance for ${controllerName}`,
				...InstanceManager.DefaultFactorioSettings,
				...settings,
			});
		} else if (instanceConfig.isInherited("factorio.settings", "name")) {
			// Each instance gets its own server name
			instanceConfig.setProp("factorio.settings", "name", serverName);
			const inherited = instanceConfig.get("instance.inherited_fields");
			instanceConfig.set("instance.inherited_fields", {
				...inherited, "factorio.settings": [...inherited["factorio.settings"] as string[], "name"],
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
		if (hostId !== null && instance.config.get("instance.is_template")) {
			throw new lib.ValidationError("Templates cannot be assigned to a host");
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
			throw new lib.ConflictError(`Instance is the template of ${inheritors} other instance(s)`);
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
