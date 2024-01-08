import type {
	CollectorResult, Logger, ParsedFactorioOutput, PlayerEvent, PluginNodeEnvInfo,
} from "@clusterio/lib";
import type Instance from "./Instance";
import type Host from "./Host";

/**
 * Base class for instance plugins
 *
 * Instance plugins are subclasses of this class which get instantiated by
 * the host when it brings up an instance with the plugin enabled in the
 * config.  To be discovered the class must be exported under the name
 * `InstancePlugin` in the module specified by the `instanceEntrypoint` in
 * the plugin's info.js file.
 *
 * Instances may be started and stopped many times, and many instances may
 * be running at the same time, each of which will have their own instance
 * of the InstancePlugin class.
 */
export default class BaseInstancePlugin {
	/**
	 * Logger for this plugin
	 *
	 * Instance of winston Logger for sending log messages from this
	 * plugin.  Supported methods and their corresponding log levels are
	 * `error`, `warn`, `audit`, `info` and `verbose`.
	 */
	logger: Logger;

	private _pendingRconMessages: {
		resolve: (result: string) => void,
		reject: (err: Error) => void,
		message: string,
		expectEmpty: boolean,
	}[] = [];

	private _sendingRconMessages = false;

	constructor(
		/**
		 * The plugin's own info module
		 */
		public info: PluginNodeEnvInfo,
		/**
		 * Instance the plugin started for
		 */
		public instance: Instance,
		/**
		 * Host running the instance
		 *
		 * With the exepction of accessing the host's config you should
		 * avoid ineracting with the host object directly.
		 */
		public host: Host,
	) {
		this.logger = instance.logger.child({ plugin: this.info.name }) as unknown as Logger;

		this._pendingRconMessages = [];
		this._sendingRconMessages = false;
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

	/**
	 * Called when the value of a config field changed.
	 *
	 * Invoked after the value of the config field given by `field` has
	 * changed.
	 *
	 * @param field - Name of the field that changed.
	 * @param curr - The current value of the field.
	 * @param prev - The previous value of the field.
	 */
	async onInstanceConfigFieldChanged(field: string, curr: unknown, prev: unknown) { }

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
	 * Called after the Factorio server is started
	 */
	async onStart() { }

	/**
	 * Called before the Factorio server is stopped
	 *
	 * This will not be called if for example the Factorio server crashes or
	 * is killed.
	 */
	async onStop() { }

	/**
	 * Called when the instance exits
	 *
	 * Invoked when the instance is shut down.  This may occur after init
	 * has been called if an error occurs during startup.  Note that if
	 * the plugin's init() throws this method will still be invoked.
	 */
	onExit() { }

	/**
	 * Called when the Factorio outputs a line
	 *
	 * Called when the Factorio server outputs a line on either stdout or
	 * stderr.  The output is a parsed form of the line and contains the
	 * following properties:
	 *
	 * @param parsed - parsed server output.
	 * @param line - raw line of server output.
	 */
	async onOutput(parsed: ParsedFactorioOutput, line: string) { }

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
	async onPrepareControllerDisconnect(connection: Instance) { }

	/**
	 * Called when a player joins or leaves the game
	 *
	 * Invoked when a player either joins or leaves the instance.
	 *
	 * @param event - Information about the event.
	 */
	async onPlayerEvent(event: PlayerEvent) { }

	/**
	 * Send RCON message to instance
	 *
	 * Send a message or command to the server which can potentially be
	 * executed out of order in relation to other RCON commands.
	 *
	 * This should not be called before onStart or after onStop.  A simple
	 * way to achieve this is to check that the instance status is running
	 * before sending commands. Note that the instance status is set to
	 * running some time after `onStart` and some time before `onStop` is
	 * invoked.
	 *
	 * @param message - message to send to server over RCON.
	 * @param expectEmpty -
	 *     if true throw if the response is not empty.  Useful for detecting
	 *     errors that might have been sent in response.
	 * @returns response from server.
	 */
	async sendRcon(message: string, expectEmpty=false): Promise<string> {
		return await this.instance.sendRcon(message, expectEmpty, this.info.name);
	}

	/**
	 * Send serially ordered RCON message to instance
	 *
	 * Send a message or command to the server which will not be executed
	 * out of order in relation to other RCON commands sent with this
	 * method. The ordering applies per plugin, and two plugins sending
	 * commands with this method may execute out of order in relation to
	 * each other.
	 *
	 * This should not be called before onStart or after onStop.  A simple
	 * way to achieve this is to check that the instance status is running
	 * before sending commands. Note that the instance status is set to
	 * running some time after `onStart` and some time before `onStop` is
	 * invoked.
	 *
	 * @param message - message to send to server over RCON.
	 * @param [expectEmpty=false] -
	 *     if true throw if the response is not empty.  Useful for detecting
	 *     errors that might have been sent in response.
	 * @returns response from server.
	 */
	async sendOrderedRcon(message: string, expectEmpty=false) {
		let promise = new Promise<string>((resolve, reject) => {
			this._pendingRconMessages.push({resolve, reject, message, expectEmpty});
		});
		if (!this._sendingRconMessages) {
			this._sendPendingRconMessages();
		}
		return await promise;
	}

	async _sendPendingRconMessages() {
		this._sendingRconMessages = true;
		while (this._pendingRconMessages.length) {
			let task = this._pendingRconMessages.shift()!;
			try {
				let result = await this.sendRcon(task.message, task.expectEmpty);
				task.resolve(result);
			} catch (err: any) {
				task.reject(err);
			}
		}
		this._sendingRconMessages = false;
	}
}
