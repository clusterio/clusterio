import type Controller from "./Controller";
import type InstanceRecord from "./InstanceRecord";
import type ControlConnection from "./ControlConnection";
import type HostConnection from "./HostConnection";
import * as lib from "@clusterio/lib";

export type ControllerPluginContext = lib.PluginLoadContext<{
	controller: Controller;
	metrics: any;
}>;

/**
 * Collection of controller plugin hooks
 */
export class ControllerHooks {
	constructor(logger: lib.Logger) {
		this.save = new lib.AsyncHook(logger);
		this.metrics = new lib.AsyncHook(logger);
		this.shutdown = new lib.AsyncHook(logger);
		this.instanceStatusChanged = new lib.AsyncHook(logger);
		this.instanceConfigFieldChanged = new lib.AsyncHook(logger);
		this.controllerConfigFieldChanged = new lib.AsyncHook(logger);
		this.controlConnectionEvent = new lib.AsyncHook(logger);
		this.hostConnectionEvent = new lib.AsyncHook(logger);
		this.prepareHostDisconnect = new lib.AsyncHook(logger);
		this.modPacksUpdated = new lib.AsyncHook(logger);
		this.modsUpdated = new lib.AsyncHook(logger);
		this.rolesUpdated = new lib.AsyncHook(logger);
		this.playerEvent = new lib.AsyncHook(logger);
	}

	/**
	 * Called when the controller saves data in memory to disk
	 *
	 * Invoked on the configured controller.autosave_interval by the
	 * controller and intended to be used to flush any in memory data that
	 * has changed to disk.
	 *
	 * This will also be called during graceful shutdown after {@link
	 * BaseControllerPlugin.onShutdown} have been invoked and all links have
	 * been disconnected.
	 */
	readonly save: lib.AsyncHook<[]>;

	/**
	 * Called when the status of an instance changes
	 *
	 * Invoked when the controller has changed the status of an instance
	 * or received notice from a host that the status of an instance has
	 * changed.  The possible statuses that can be notified about are:
	 * - `unassigned:`: Instance is no longer asssigned to a host.
	 * - `unknown`: Host assigned to instance is offline.
	 * - `stopped`: Instance is no longer running or was just assigned to a
	 *   host.
	 * - `starting`: Instance is in the process of starting up.
	 * - `running`: Instance startup completed and is now running.
	 * - `stopping`: Instance is in the processing stopping.
	 * - `creating_save`: Instance is in the process of creating a save.
	 * - `exporting_data`: Instance is in the process of exporting item
	 *   icons and locale data.
	 * - `deleted`: Instance was deleted.
	 *
	 * On controller startup all known instances gets the status `unknown` if
	 * they are assigned to a host, when the host then connects to the
	 * controller and informs of the current status of its instances this hook
	 * is invoked for all those instances.  You can detect this situation by
	 * checking if prev equals `unknown`.  If the host disconnects the
	 * instances will again get the `unknown` status.
	 *
	 * When instances are created on the controller they will notify of a status
	 * change with prev set to null.  While the status of new instances is
	 * in most cases `unassigned` it's possible for the created instance to
	 * start with any state in some host connection corner cases.
	 *
	 * Note that it's possible for status change notification to get lost in
	 * the case of network outages if reconnect fails to re-establish the
	 * session between the controller and the host.
	 *
	 * @param instance -
	 *     The instance that changed.
	 * @param prev - the previous status of the instance.
	 */
	readonly instanceStatusChanged: lib.AsyncHook<[instance: InstanceRecord, prev: lib.InstanceStatus | undefined]>;

	/**
	 * Called when the value of a controller config field changed.
	 *
	 * Invoked after the value of the config field given by `field` has
	 * changed on the controller.
	 *
	 * @param field - Name of the field that changed.
	 * @param curr - The current value of the field.
	 * @param prev - The previous value of the field.
	 */
	readonly controllerConfigFieldChanged: lib.AsyncHook<[field: string, curr: unknown, prev: unknown]>;

	/**
	 * Called when the value of an instance config field changed.
	 *
	 * Invoked after the value of the config field given by `field` has
	 * changed on an instance.
	 *
	 * @param instance -
	 *     The instance the config changed on.
	 * @param field - Name of the field that changed.
	 * @param curr - The current value of the field.
	 * @param prev - The previous value of the field.
	 */
	// eslint-disable-next-line max-len
	readonly instanceConfigFieldChanged: lib.AsyncHook<[instance: InstanceRecord, field: string, curr: unknown, prev: unknown]>;

	/**
	 * Called before collecting Prometheus metrics
	 *
	 * Invoked before the default metrics of prometheus is collected.  Note
	 * that since this is done while replying to /metrics this should not
	 * take a long time, otherwise the requst will time out.
	 *
	 * Although you can return the results of collecting your prometheus
	 * collectors directly, all gauges in the default registry is already
	 * automatically collected.  It's therefore recommended to only update
	 * the Gauges/Counters/etc in onMetric and let Clusterio deal will
	 * collecting the values.
	 *
	 * @returns an async iterator of prometheus metric results or undefined.
	 */
	readonly metrics: lib.AsyncHook<[], AsyncIterable<lib.CollectorResult>>;

	/**
	 * Called when the controller is shutting down
	 */
	readonly shutdown: lib.AsyncHook<[]>;

	/**
	 * Called when an event on a host connection happens
	 *
	 * The event param may be one of connect, drop, resume and close and has
	 * the following meaning:
	 *
	 * ##### connect
	 *
	 * Invoked when a new connection to the host has been established.
	 *
	 * ##### drop
	 *
	 * Invoked when a connection loss is detected between the controller and a
	 * host.  Plugins should respond to this event by throtteling messages
	 * it is sending to the given host connection to an absolute minimum.
	 *
	 * Messages sent over a dropped host connection will get queued up in
	 * memory on the controller and sent all in one go when the connection is
	 * re-established again.
	 *
	 * ##### resume
	 *
	 * Invoked when a connection that had previously been dropped is
	 * re-established
	 *
	 * ##### close
	 *
	 * Invoked when the connection to the host has been closed.
	 *
	 * @param connection -
	 *     The connection the event occured on.
	 * @param event - one of connect, drop, resume and close
	 */
	// eslint-disable-next-line max-len
	readonly hostConnectionEvent: lib.AsyncHook<[connection: HostConnection, event: "connect" | "drop" | "resume" | "close"]>;

	/**
	 * Called when an avent on a control connection happens
	 *
	 * The event param may be one of connect, drop, resume and close and has
	 * the following meaning:
	 *
	 * ##### connect
	 *
	 * Invoked when a new connection to the control has been established.
	 *
	 * ##### drop
	 *
	 * Invoked when a connection loss is detected between the controller and a
	 * control.  Plugins should respond to this event by throtteling
	 * messages it is sending to the given control connection to an absolute
	 * minimum.
	 *
	 * Messages sent over a dropped control connection will get queued up in
	 * memory on the controller and sent all in one go when the connection is
	 * re-established again.
	 *
	 * ##### resume
	 *
	 * Invoked when a connection that had previously been dropped is
	 * re-established.
	 *
	 * ##### close
	 *
	 * Invoked when the connection to the control has been closed.
	 *
	 * @param connection -
	 *     The connection the event occured on.
	 * @param event - one of connect, drop, resume, and close.
	 */
	// eslint-disable-next-line max-len
	readonly controlConnectionEvent: lib.AsyncHook<[connection: ControlConnection, event: "connect" | "drop" | "resume" | "close"]>;

	/**
	 * Called when a host is preparing to disconnect from the controller
	 *
	 * Invoked when a host has requested the disconnection from the controller.
	 * This typically happens when it is in the process of shutting down.
	 *
	 * Plugins must stop sending messages to the host in question after the
	 * prepare disconnect has been handled.
	 *
	 * @param connection -
	 *     The connection to the host preparing to disconnect.
	 */
	readonly prepareHostDisconnect: lib.AsyncHook<[connection: HostConnection]>;

	/**
	 * Called when one or more mod packs are updated
	 *
	 * Invoked when one or more mod pack have been added, updated or deleted
	 * in the cluster.
	 *
	 * If a mod pack has been deleted its `.isDeleted` property will be
	 * true.
	 *
	 * @param modPacks - Mod packs that updated.
	 */
	readonly modPacksUpdated: lib.AsyncHook<[modPacks: lib.ModPack[]]>;

	/**
	 * Called when one or more mod stored on the controller are updated
	 *
	 * Invoked when one or more mods have been added, updated or deleted
	 * from the pool of shared mods stored on the cluster.
	 *
	 * If a mod has been deleted its `.isDeleted` property will be true.
	 *
	 * @param mods - Mods that updated.
	 */
	readonly modsUpdated: lib.AsyncHook<[mods: lib.ModInfo[]]>;

	/**
	 * Called when one or more roles stored on the controller are updated
	 *
	 * Invoked when one or more roles have been added, updated or deleted.
	 *
	 * If a role has been deleted its `.isDeleted` property will be true.
	 *
	 * @param roles - Roles that updated.
	 */
	readonly rolesUpdated: lib.AsyncHook<[roles: lib.Role[]]>;

	/**
	 * Called when a player joins or leaves an instance
	 *
	 * Invoked when a player either joins or leaves an instance in the
	 * cluster.
	 *
	 * @param instance -
	 *     The instance it occured on.
	 * @param event - Information about the event.
	 */
	readonly playerEvent: lib.AsyncHook<[instance: InstanceRecord, event: lib.PlayerEvent]>;
}

/**
 * Base class for controller plugins
 *
 * Controller plugins are subclasses of this class which get instantiated by
 * the controller on startup when the plugin is enabled in the config.
 * To be discovered the class must be exported under the name `ControllerPlugin`
 * in the module specified by the `controllerEntrypoint` in the plugin's
 * `plugin` export.
 */
export class BaseControllerPlugin {
	constructor(
		public info: lib.PluginNodeEnvInfo,
		public controller: Controller,
		public metrics: any,
		public logger: lib.Logger,
	) {
		const attach = <Args extends unknown[], Return>(
			hook: lib.AsyncHook<Args, Return>,
			fn?: lib.HookHandler<Args, Return>,
		) => {
			if (fn) {
				hook.attach(info.name, fn.bind(this));
			}
		};

		attach(controller.hooks.save, this.onSaveData);
		attach(controller.hooks.instanceStatusChanged, this.onInstanceStatusChanged);
		attach(controller.hooks.controllerConfigFieldChanged, this.onControllerConfigFieldChanged);
		attach(controller.hooks.instanceConfigFieldChanged, this.onInstanceConfigFieldChanged);
		attach(controller.hooks.metrics, this.onMetrics);
		attach(controller.hooks.shutdown, this.onShutdown);
		attach(controller.hooks.hostConnectionEvent, this.onHostConnectionEvent);
		attach(controller.hooks.controlConnectionEvent, this.onControlConnectionEvent);
		attach(controller.hooks.prepareHostDisconnect, this.onPrepareHostDisconnect);
		attach(controller.hooks.modPacksUpdated, this.onModPacksUpdated);
		attach(controller.hooks.modsUpdated, this.onModsUpdated);
		attach(controller.hooks.rolesUpdated, this.onRolesUpdated);
		attach(controller.hooks.playerEvent, this.onPlayerEvent);
	}

	static fromContext(context: ControllerPluginContext) {
		return new this(context.plugin, context.controller, context.metrics, context.logger);
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

	async onSaveData() { }

	async onInstanceStatusChanged(instance: InstanceRecord, prev?: lib.InstanceStatus) { }

	async onControllerConfigFieldChanged(field: string, curr: unknown, prev: unknown) { }

	async onInstanceConfigFieldChanged(instance: InstanceRecord, field: string, curr: unknown, prev: unknown) { }

	async onMetrics(): Promise<void | AsyncIterable<lib.CollectorResult>> { }

	async onShutdown() { }

	onHostConnectionEvent(connection: HostConnection, event: "connect" | "drop" | "resume" | "close") { }

	onControlConnectionEvent(connection: ControlConnection, event: "connect" | "drop" | "resume" | "close") { }

	async onPrepareHostDisconnect(connection: HostConnection) { }

	async onModPacksUpdated(modPacks: lib.ModPack[]) { }

	async onModsUpdated(mods: lib.ModInfo[]) { }

	async onRolesUpdated(roles: lib.Role[]) { }

	async onPlayerEvent(instance: InstanceRecord, event: lib.PlayerEvent) { }

	/**
	 * Broadcast event to all connected hosts
	 *
	 * Sends the given event to all hosts connected to the controller.
	 * This does not include hosts that are in the process of closing the
	 * connection, which typically happens when they are shutting down.
	 *
	 * @param event - Event to send
	 */
	broadcastEventToHosts<T>(event: lib.Event<T>) {
		for (let hostConnection of this.controller.wsServer.hostConnections.values()) {
			if (
				!hostConnection.connector.closing
				&& (!event.constructor.plugin || hostConnection.plugins.has(event.constructor.plugin))
			) {
				hostConnection.send(event);
			}
		}
	}
}
