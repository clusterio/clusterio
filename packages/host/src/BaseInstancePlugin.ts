import type Instance from "./Instance.js";
import type Host from "./Host.js";

import * as lib from "@clusterio/lib";

export type InstancePluginContext = lib.PluginLoadContext<{
	host: Host;
	instance: Instance;
}>;

/**
 * Collection of instance plugin hooks
 */
export class InstanceHooks extends lib.AsyncHookCollection {
	constructor(logger: lib.Logger) {
		super(logger);
		this.metrics = this.newHook();
		this.start = this.newHook();
		this.stop = this.newHook();
		this.exit = this.newHook();
		this.output = this.newHook();
		this.instanceConfigFieldChanged = this.newHook();
		this.controllerConnectionEvent = this.newHook();
		this.prepareControllerDisconnect = this.newHook();
		this.playerEvent = this.newHook();
		this.autoPauseChanged = this.newHook();
		// Long timeout as handlers may create a save
		this.chooseSave = this.newHook(logger, 300_000);
	}

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
	readonly instanceConfigFieldChanged: lib.AsyncHook<[field: string, curr: unknown, prev: unknown]>;

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
	readonly metrics: lib.AsyncHook<[], AsyncIterable<lib.CollectorResult> | void>;

	/**
	 * Called to pick the save to start when none was requested
	 *
	 * Invoked after mods have been synced when the instance is started
	 * without a save being specified. Handlers may create a save in the
	 * saves directory of the instance and return its name to have it
	 * started instead of the newest save. Return undefined to leave the
	 * choice to other plugins and the default of the newest save.
	 *
	 * @returns name of save in the instance's saves directory to start.
	 */
	readonly chooseSave: lib.AsyncHook<[], string | undefined>;

	/**
	 * Called after the Factorio server is started
	 */
	readonly start: lib.AsyncHook<[]>;

	/**
	 * Called before the Factorio server is stopped
	 *
	 * This will not be called if for example the Factorio server crashes or
	 * is killed.
	 */
	readonly stop: lib.AsyncHook<[]>;

	/**
	 * Called when the instance exits
	 *
	 * Invoked when the instance is shut down.  This may occur after init
	 * has been called if an error occurs during startup.  Note that if
	 * the plugin's init() throws this method will still be invoked.
	 */
	readonly exit: lib.AsyncHook<[]>;

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
	readonly output: lib.AsyncHook<[parsed: lib.ParsedFactorioOutput, line: string]>;

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
	readonly controllerConnectionEvent: lib.AsyncHook<[event: "connect" | "drop" | "resume" | "close"]>;

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
	readonly prepareControllerDisconnect: lib.AsyncHook<[connection: Instance]>;

	/**
	 * Called when a player joins or leaves the game
	 *
	 * Invoked when a player either joins or leaves the instance.
	 *
	 * @param event - Information about the event.
	 */
	readonly playerEvent: lib.AsyncHook<[event: lib.PlayerEvent]>;

	/**
	 * Called when Factorio auto pauses or unpauses the game
	 *
	 * Invoked when the last player leaves or the first player joins an
	 * instance started with the auto_pause server setting on.  Every RCON
	 * command makes a paused game run one tick, so periodic commands
	 * should be skipped while paused.  See `Instance.autoPaused`.  It is
	 * not invoked on start, read `autoPaused` in the start hook instead.
	 *
	 * @param paused - true if the game is now paused.
	 */
	readonly autoPauseChanged: lib.AsyncHook<[paused: boolean]>;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface BaseInstancePlugin {
	onInstanceConfigFieldChanged?(field: string, curr: unknown, prev: unknown): Promise<void>;
	onMetrics?(): Promise<void | AsyncIterable<lib.CollectorResult>>;
	onStart?(): Promise<void>;
	onStop?(): Promise<void>;
	onExit?(): void;
	onOutput?(parsed: lib.ParsedFactorioOutput, line: string): Promise<void>;
	onControllerConnectionEvent?(event: "connect" | "drop" | "resume" | "close"): void;
	onPrepareControllerDisconnect?(connection: Instance): Promise<void>;
	onPlayerEvent?(event: lib.PlayerEvent): Promise<void>;
	onAutoPauseChanged?(paused: boolean): Promise<void>;
}

/**
 * Base class for instance plugins
 *
 * Instance plugins are subclasses of this class which get instantiated by
 * the host when it brings up an instance with the plugin enabled in the
 * config.  To be discovered the class must be exported under the name
 * `InstancePlugin` in the module specified by the `instanceEntrypoint` in
 * the plugin's `plugin` export.
 *
 * Instances may be started and stopped many times, and many instances may
 * be running at the same time, each of which will have their own instance
 * of the InstancePlugin class.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class BaseInstancePlugin {
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
		public info: lib.PluginNodeEnvInfo,
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

		attach(instance.hooks.instanceConfigFieldChanged, this.onInstanceConfigFieldChanged);
		attach(instance.hooks.metrics, this.onMetrics);
		attach(instance.hooks.start, this.onStart);
		attach(instance.hooks.stop, this.onStop);
		attach(instance.hooks.exit, this.onExit);
		attach(instance.hooks.output, this.onOutput);
		attach(instance.hooks.controllerConnectionEvent, this.onControllerConnectionEvent);
		attach(instance.hooks.prepareControllerDisconnect, this.onPrepareControllerDisconnect);
		attach(instance.hooks.playerEvent, this.onPlayerEvent);
		attach(instance.hooks.autoPauseChanged, this.onAutoPauseChanged);
	}

	static fromContext(context: InstancePluginContext) {
		return new this(context.plugin, context.instance, context.host, context.logger);
	}

	detachHooks() {
		this.instance.hooks.detachAll(this.info.name);
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() {}

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
	 * Send UDP message to instance
	 *
	 * Send a UDP packet to the Factorio server, which is delivered in-game
	 * as an on_udp_packet_received event.  Delivery is not guaranteed and
	 * the payload should be kept well below 64 kB.  Requires the LuaUdp
	 * plugin feature.
	 *
	 * This should not be called before onStart or after onStop.
	 *
	 * @param message - payload of the packet to send.
	 */
	async sendUdp(message: string | Buffer): Promise<void> {
		await this.instance.sendUdp(message);
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
