import * as lib from "@clusterio/lib";

import type Controller from "./Controller";
import type HostConnection from "./HostConnection";
import InstanceRecord from "./InstanceRecord";

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
	 * @throws {module:lib.RequestError} if the instance does not exist.
	 */
	getForRequest(instanceId: number): InstanceRecord {
		const instance = this.records.get(instanceId);
		if (!instance) {
			throw new lib.RequestError(`Instance with ID ${instanceId} does not exist`);
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
		await lib.invokeHook(
			this._controller.plugins,
			"onInstanceStatusChanged",
			instance,
			prev,
		);
	}

	private async _notifyConfigFieldChanged(
		instance: InstanceRecord,
		field: string,
		curr: unknown,
		prev: unknown,
	): Promise<void> {
		await lib.invokeHook(
			this._controller.plugins,
			"onInstanceConfigFieldChanged",
			instance,
			field,
			curr,
			prev,
		);
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
			this.records.set(instance);
			this._notifyConfigFieldChanged(instance, field, curr, prev);
		});
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
	 * @throws {module:lib.RequestError} if an instance with the same ID already exists.
	 */
	async createInstance(
		instanceConfig: lib.InstanceConfig,
		_suppressChanges?: boolean,
	): Promise<InstanceRecord> {
		const instanceId = instanceConfig.get("instance.id");
		if (this.records.has(instanceId)) {
			throw new lib.RequestError(`Instance with ID ${instanceId} already exists`);
		}

		const controllerName = this._controller.config.get("controller.name");
		instanceConfig.set("factorio.settings", {
			name: `${controllerName} - ${instanceConfig.get("instance.name")}`,
			description: `Clusterio instance for ${controllerName}`,
			...InstanceManager.DefaultFactorioSettings,
			...instanceConfig.get("factorio.settings"),
		});

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
	 * @throws {module:lib.RequestError} if the instance does not exist.
	 * @throws {module:lib.RequestError} if the target host is not connected.
	 */
	async assignInstance(
		instanceId: number,
		hostId?: number,
	): Promise<void> {
		const instance = this.getForRequest(instanceId);
		const hostConnections = this._controller.wsServer.hostConnections;

		const currentAssignedHost = instance.config.get("instance.assigned_host");
		if ((currentAssignedHost ?? undefined) === hostId) {
			return;
		}

		let newHostConnection: HostConnection | undefined;
		if (hostId !== undefined) {
			newHostConnection = hostConnections.get(hostId);
			if (!newHostConnection) {
				throw new lib.RequestError("Target host is not connected to the controller");
			}
		}

		if (currentAssignedHost !== null && hostId !== currentAssignedHost) {
			const oldHostConnection = hostConnections.get(currentAssignedHost);
			if (oldHostConnection && !oldHostConnection.connector.closing) {
				await oldHostConnection.send(
					new lib.InstanceUnassignInternalRequest(instanceId),
				);
			}
		}

		this._controller.clearSavesOfInstance(instanceId);
		instance.config.set("instance.assigned_host", hostId ?? null);

		if (hostId !== undefined && newHostConnection) {
			await newHostConnection.send(
				new lib.InstanceAssignInternalRequest(instanceId, instance.config.toRemote("host")),
			);
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
		return this.assignInstance(instanceId, undefined);
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
	 * @throws {module:lib.RequestError} if the instance does not exist.
	 */
	async deleteInstance(instanceId: number): Promise<void> {
		const instance = this.getForRequest(instanceId);
		const hostId = instance.config.get("instance.assigned_host");

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
