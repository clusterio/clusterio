import type {
	CollectorResult, Logger, ParsedFactorioOutput, PlayerEvent, PluginNodeEnvInfo,
} from "@clusterio/lib";
import type Host from "./Host";

/**
 * Base class for host plugins
 *
 * Host plugins are subclasses of this class which get instantiated by
 * the host when it starts up with the plugin enabled in the config.  To be
 * discovered the class must be exported under the name `HostPlugin` in the
 * module specified by the `hostEntrypoint` in the plugin's `plugin` export.
 */
export default class BaseHostPlugin {
	/**
	 * Logger for this plugin
	 *
	 * Instance of winston Logger for sending log messages from this
	 * plugin.  Supported methods and their corresponding log levels are
	 * `error`, `warn`, `audit`, `info` and `verbose`.
	 */
	logger: Logger;

	constructor(
		/**
		 * The plugin's own info module
		 */
		public info: PluginNodeEnvInfo,
		/**
		 * Host the plugin started for
		 */
		public host: Host,
		logger: Logger,
	) {
		this.logger = logger.child({ plugin: this.info.name }) as unknown as Logger;
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

	/**
	 * Called when the value of a host config field changed.
	 *
	 * Invoked after the value of the config field given by `field` has
	 * changed on this host.
	 *
	 * @param field - Name of the field that changed.
	 * @param curr - The current value of the field.
	 * @param prev - The previous value of the field.
	 */
	async onHostConfigFieldChanged(field: string, curr: unknown, prev: unknown) { }

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
	 * Called when the host is shutting down
	 */
	async onShutdown() { }

	/**
	 * Called when an event on the controller connection happens
	 *
	 * The event param may be one of connect, drop, resume and close and has
	 * the following meaning:
	 *
	 * ##### connect
	 *
	 * Invoked when a new connection to the controller has been established.
	 *
	 * ##### drop
	 *
	 * Invoked when a connection loss is detected between the host and the
	 * controller.  Plugins should respond to this event by throtteling messages
	 * it is sending to the controller to an absolute minimum.
	 *
	 * Messages sent over a dropped controller connection will get queued up in
	 * memory on the host and sent all in one go when the connection is
	 * re-established again.
	 *
	 * ##### resume
	 *
	 * Invoked when the connection that had previously dropped is
	 * re-established.
	 *
	 * ##### close
	 *
	 * Invoked when the connection to the controller has been closed.  This
	 * typically means the controller has shut down.  Plugins should not
	 * send any messages that goes to or via the controller after the
	 * connection has been closed and before a new one is established.
	 *
	 * @param event - one of connect, drop, resume and close
	 */
	onControllerConnectionEvent(event: "connect" | "drop" | "resume" | "close") { }

	/**
	 * Called when the controller is preparing to disconnect from the host
	 *
	 * Invoked when the controller has requested the disconnection from
	 * the host.  This typically happens when it is in the process of
	 * shutting down.
	 *
	 * Plugins must stop sending messages to the controller, or are forwarded
	 * via the controller after the prepare disconnect has been handled.
	 *
	 * @param connection -
	 *     The connection to the host preparing to disconnect.
	 */
	async onPrepareControllerDisconnect(connection: Host) { }
}
