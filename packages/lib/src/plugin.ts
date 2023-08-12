/**
 * Plugin interfaces and utilities.
 * @module lib/plugin
 */
import * as libHelpers from "./helpers";
import type { Logger } from "./logging";
import type { ConfigGroup } from "./config";
import type { CollectorResult } from "./prometheus";
import type { ParsedFactorioOutput } from "./logging_utils";
import type { ModPack, ModInfo } from "./data";
import type { Link } from "./link";
import type { CommandTree } from "./command";

/**
 * Conceptual base for controller and instance plugins.
 */
export type BasePlugin =
	| BaseControllerPlugin
	| BaseInstancePlugin
	| BaseControlPlugin
	| BaseWebPlugin
;

// TODO Add proper typing for plugins
export type PluginInfo = any;
type Controller = any;
type Instance = any;
type Host = any;
type InstanceInfo = any;
type HostConnection = any;
type ControlConnection = any;
type Event = any;
type React = any;

/**
 * Information about the event.
 */
interface PlayerEvent {
	type: "join" | "leave" | "import";
	/** Name of the player that joined/left */
	name: string,
	/**
	 * Only present for type "leave". Reason for player leaving the
	 * game, one of the possible reasons in defines.disconnect_reason
	 * or "server_quit" if the server exits while the player is online.
	 */
	reason?: string;
}
type InstanceStatus =
	| "unassigned"
	| "unknown"
	| "stopped"
	| "starting"
	| "running"
	| "stopping"
	| "creating_save"
	| "exporting_data"
	| "deleted"
;

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
export class BaseInstancePlugin {
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
		public info: PluginInfo,
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
	 * @param group -
	 *     The group who's field got changed.
	 * @param field - Name of the field that changed.
	 * @param prev - The previous value of the field.
	 */
	async onInstanceConfigFieldChanged(group: ConfigGroup, field: string, prev: unknown) { }

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
	async onMetrics(): Promise<void | AsyncIterator<CollectorResult>> { }

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
	async onPrepareControllerDisconnect(connection: HostConnection) { }

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

/**
 * Base class for controller plugins
 *
 * Controller plugins are subclasses of this class which get instantiated by
 * the controller on startup when the plugin is enabled in the config.
 * To be discovered the class must be exported under the name `ControllerPlugin`
 * in the module specified by the `controllerEntrypoint` in the plugin's info.js
 * file.
 */
export class BaseControllerPlugin {
	/**
	 * Logger for this plugin
	 *
	 * Instance of winston Logger for sending log messages from this
	 * plugin.  Supported methods and their corresponding log levels are
	 * `error`, `warn`, `audit`, `info` and `verbose`.
	 */
	logger: Logger;

	constructor(
		public info: PluginInfo,
		public controller: Controller,
		public metrics: any[],
		logger: Logger
	) {
		this.logger = logger.child({ plugin: this.info.name }) as unknown as Logger;
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

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
	async onMetrics(): Promise<void | AsyncIterator<CollectorResult>> { }

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
	 * Called when a mod pack is updated
	 *
	 * Invoked when a mod pack has been added, updated or deleted in the
	 * cluster.
	 *
	 * If the mod pack has been deleted its `.isDeleted` property will be
	 * true.
	 *
	 * @param modPack - Mod pack that updated.
	 */
	async onModPackUpdated(modPack: ModPack) { }

	/**
	 * Called when a mod stored on the controller is updated
	 *
	 * Invoked when a mod has been added, updated or deleted from the pool
	 * of shared mods stored on the cluster.
	 *
	 * If a mod has been deleted its `.isDeleted` property will be true.
	 *
	 * @param mod - Mod that updated.
	 */
	async onModUpdated(mod: ModInfo) { }

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
	broadcastEventToHosts(event: Event) {
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

/**
 * Base class for clusterioctl plugins
 *
 * Control plugins are subclasses of this class which get instantiated by
 * clusterioctl in order to extend its functionallity.  To be discovered the
 * class must be exported under the name `ControlPlugin` in the module
 * specified by the `controlEntrypoint` in the plugin's info.js file.
 */
export class BaseControlPlugin {
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
		public info: PluginInfo,
		logger: Logger,
	) {
		this.logger = logger.child({ plugin: this.info.name }) as unknown as Logger;
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

	/**
	 * Called to add commands to the command line interface.
	 *
	 * Invoked by clusterioctl to let plugins add commands.  `rootCommand` is
	 * the top level command node which the plugin should add its own {@link
	 * CommandTree} to.
	 *
	 * @param rootCommand -
	 *     Root of the clusterioctl command tree.
	 */
	async addCommands(rootCommand: CommandTree) { }
}



/**
 * Plugin supplied login form
 */
export interface PluginLoginForm {
	/**
	 * Internal name of the login form, this should start with the
	 * plugin name followed by a dot.
	 */
	name: string;

	/** Name displayed above this form in the login window.  */
	title: string;

	/**
	 * React component that's rendered for this login form.  This is
	 * supplied the setToken function via its props which should be called
	 * when an authentication token is aquired via this form.
	 */
	Component: React["Component"];
};


/**
 * Plugin supplied pages
 */
export interface PluginPage {
	/** URL path to this page. */
	path: string;
	/**
	 * If present and this path matches one of the pages in the sidebar it
	 * will cause that sidebar entry to be highlighted as active.
	 */
	sidebarPath?: string;
	/**
	 * If present group this entry under a group of the given name in the
	 * sidebar.
	 */
	sidebarGroup?: string;
	/**
	 * If present creates an entry in the sidebar for this page with the
	 * given text.
	 */
	sidebarName?: string;
	/**
	 * A react node which is rendered when this page is navigated to.
	 * Should render a PageLayout.
	 */
	content?: React["ReactNode"];
};

/**
 * Base class for web interface plugins
 */
export class BaseWebPlugin {
	/**
	 * Contents of the plugin's package.json file
	 */
	package: any;
	/**
	 * Control link to the controller, not available until the
	 * connect event in onControllerConnectionEvent is signaled.
	 */
	control?: Link;
	/**
	 * Logger for this plugin
	 *
	 * Instance of winston Logger for sending log messages from this
	 * plugin.  Supported methods and their corresponding log levels are
	 * `error`, `warn`, `audit`, `info` and `verbose`.
	 */
	logger: Logger;
	/**
	 * List of login forms provided by this plugin
	 */
	loginForms: PluginLoginForm[] = [];
	/**
	 * List of pages provided by this plugin
	 */
	pages: PluginPage[] = [];
	/**
	 * Extra react component to add to core components
	 *
	 * Interface to augment core components of the web UI.  Setting a
	 * component as one of the supported properties of this object will
	 * cause the web UI to render it when displaying that component,
	 * usually at the end.  Each component will receive a `plugin` param
	 * which is the instance of the web plugin that contained the
	 * component extra.
	 */
	componentExtra: {
		/** Placed at the end of the controller page. */
		ControllerPage?: React["ComponentType"],
		/** Placed at the end of the hosts list page. */
		HostsPage?: React["ComponentType"],
		/**
		 * Placed at the end of each host page.  Takes a `host` param which
		 * is the host the page is displayed for.
		 */
		HostViewPage?: React["ComponentType"],
		/** Placed at the end of the instance list page.  */
		InstancesPage?: React["ComponentType"],
		/**
		 * Placed at the end of each instance page.  Takes an `instance`
		 * param which is the instance the page is displayed for.
		 */
		InstanceViewPage?: React["ComponentType"],
		/** Placed at the end of the users list page.  */
		UsersPage?: React["ComponentType"],
		/**
		 * Placed at the end of each user page.  Takes a `user` param which
		 * is the user object the page is displayed for.
		 */
		UserViewPage?: React["ComponentType"],
		/** Placed at the end of the roles list page.  */
		RolesPage?: React["ComponentType"],
		/**
		 * Placed at the end of each role page.  Takes a `role` param which
		 * is the role object the page is displayed for.
		 */
		RoleViewPage?: React["ComponentType"],
	} = {};


	constructor(
		/**
		 * Webpack container for this plugin
		 */
		public container: any,
		packageData: any,
		/**
		 * The plugin's own info module
		 */
		public info: PluginInfo,
		logger: Logger,
	) {
		this.package = packageData;
		this.logger = logger.child({ plugin: this.info.name }) as unknown as Logger;
	}

	/**
	 * Called immediately after the class is instantiated.
	 */
	async init() { }

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
	 * Invoked when a connection loss is detected between the control link
	 * and the controller.  Plugins should respond to this event by throtteling
	 * messages it is sending to the controller to an absolute minimum.
	 *
	 * Messages sent over a dropped controller connection will get queued up in
	 * memory in the browser and sent all in one go when the connection is
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
}

/**
 * Invokes the given hook on all plugins
 *
 * @param plugins -
 *     Mapping of plugin names to plugins to invoke the hook on.
 * @param hook - Name of hook to invoke.
 * @param args - Arguments to pass on to the hook.
 * @returns Non-undefined return values from the hooks.
 */
export async function invokeHook(plugins: Map<string, BasePlugin>, hook: string, ...args: any[]) {
	let results: unknown[] = [];
	for (let [name, plugin] of plugins) {
		try {
			// Use an object to detect if the hook failed on timeout or tried to return a value looking like an error
			const timeout = {};
			let result = await libHelpers.timeout(
				(plugin as any)[hook](...args),
				15000,
				timeout
			);
			if (result === timeout) {
				throw new Error(`Invoking hook ${hook} timed out for plugin ${name}`);
			} else if (result !== undefined) {
				results.push(result);
			}
		} catch (err: any) {
			plugin.logger.error(`Ignoring error from plugin ${name} in ${hook}:\n${err.stack}`);
		}
	}
	return results;
}
