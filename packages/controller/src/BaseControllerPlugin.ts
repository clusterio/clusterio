import type {
	CollectorResult, ConfigGroup, Event, InstanceStatus, Logger,
	ModPack, ModInfo, PlayerEvent, PluginNodeEnvInfo,
} from "@clusterio/lib";
import type Controller from "./Controller";
import type InstanceInfo from "./InstanceInfo";
import type ControlConnection from "./ControlConnection";
import type HostConnection from "./HostConnection";

/**
 * Base class for controller plugins
 *
 * Controller plugins are subclasses of this class which get instantiated by
 * the controller on startup when the plugin is enabled in the config.
 * To be discovered the class must be exported under the name `ControllerPlugin`
 * in the module specified by the `controllerEntrypoint` in the plugin's info.js
 * file.
 */
export default class BaseControllerPlugin {
	/**
	 * Logger for this plugin
	 *
	 * Instance of winston Logger for sending log messages from this
	 * plugin.  Supported methods and their corresponding log levels are
	 * `error`, `warn`, `audit`, `info` and `verbose`.
	 */
	logger: Logger;

	constructor(
		public info: PluginNodeEnvInfo,
		public controller: Controller,
		public metrics: any,
		logger: Logger
	) {
		this.logger = logger.child({ plugin: this.info.name }) as unknown as Logger;
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

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
	async onSaveData() { }

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
	async onInstanceStatusChanged(instance: InstanceInfo, prev?: InstanceStatus) { }

	/**
	 * Called when the value of a controller config field changed.
	 *
	 * Invoked after the value of the config field given by `field` has
	 * changed on the controller.
	 *
	 * @param group -
	 *     The group who's field got changed.
	 * @param field - Name of the field that changed.
	 * @param prev - The previous value of the field.
	 */
	async onControllerConfigFieldChanged(group: ConfigGroup, field: string, prev: unknown) { }

	/**
	 * Called when the value of an instance config field changed.
	 *
	 * Invoked after the value of the config field given by `field` has
	 * changed on an instance.
	 *
	 * @param instance -
	 *     The instance the config changed on.
	 * @param group -
	 *     The group who's field got changed.
	 * @param field - Name of the field that changed.
	 * @param prev - The previous value of the field.
	 */
	async onInstanceConfigFieldChanged(instance: InstanceInfo, group: ConfigGroup, field: string, prev: unknown) { }

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
	async onMetrics(): Promise<void | AsyncIterable<CollectorResult>> { }

	/**
	 * Called when the controller is shutting down
	 */
	async onShutdown() { }

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
	onHostConnectionEvent(connection: HostConnection, event: "connect" | "drop" | "resume" | "close") { }

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
	onControlConnectionEvent(connection: ControlConnection, event: "connect" | "drop" | "resume" | "close") { }

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
	async onPrepareHostDisconnect(connection: HostConnection) { }

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
	async onModPacksUpdated(modPacks: ModPack[]) { }

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
	async onModsUpdated(mods: ModInfo[]) { }

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
	async onPlayerEvent(instance: InstanceInfo, event: PlayerEvent) { }

	/**
	 * Broadcast event to all connected hosts
	 *
	 * Sends the given event to all hosts connected to the controller.
	 * This does not include hosts that are in the process of closing the
	 * connection, which typically happens when they are shutting down.
	 *
	 * @param event - Event to send
	 */
	broadcastEventToHosts<T>(event: Event<T>) {
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
