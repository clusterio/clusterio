import type Host from "./Host";

import * as lib from "@clusterio/lib";

export type HostPluginContext = lib.PluginLoadContext<{
	host: Host;
}>;

/**
 * Collection of host plugin hooks
 */
export class HostHooks {
	constructor(logger: lib.Logger) {
		this.metrics = new lib.AsyncHook(logger);
		this.shutdown = new lib.AsyncHook(logger);
		this.hostConfigFieldChanged = new lib.AsyncHook(logger);
		this.controllerConnectionEvent = new lib.AsyncHook(logger);
		this.prepareControllerDisconnect = new lib.AsyncHook(logger);
	}

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
	readonly hostConfigFieldChanged: lib.AsyncHook<[field: string, curr: unknown, prev: unknown]>;

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
	 * Called when the host is shutting down
	*/
	readonly shutdown: lib.AsyncHook<[]>;

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
	readonly prepareControllerDisconnect: lib.AsyncHook<[connection: Host]>;
}

/**
 * Base class for host plugins
 *
 * Host plugins are subclasses of this class which get instantiated by
 * the host when it starts up with the plugin enabled in the config.  To be
 * discovered the class must be exported under the name `HostPlugin` in the
 * module specified by the `hostEntrypoint` in the plugin's `plugin` export.
 */
export class BaseHostPlugin {
	constructor(
		public info: lib.PluginNodeEnvInfo,
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

		attach(host.hooks.hostConfigFieldChanged, this.onHostConfigFieldChanged);
		attach(host.hooks.metrics, this.onMetrics);
		attach(host.hooks.shutdown, this.onShutdown);
		attach(host.hooks.controllerConnectionEvent, this.onControllerConnectionEvent);
		attach(host.hooks.prepareControllerDisconnect, this.onPrepareControllerDisconnect);
	}

	static fromContext(context: HostPluginContext): BaseHostPlugin {
		const plugin = new this(context.plugin, context.host, context.logger);
		return plugin;
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

	async onHostConfigFieldChanged(field: string, curr: unknown, prev: unknown) { }

	async onMetrics(): Promise<void | AsyncIterable<lib.CollectorResult>> { }

	async onShutdown() { }

	onControllerConnectionEvent(event: "connect" | "drop" | "resume" | "close") { }

	async onPrepareControllerDisconnect(connection: Host) { }
}
