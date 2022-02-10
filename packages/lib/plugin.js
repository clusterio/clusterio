/**
 * Plugin interfaces and utilities.
 * @module lib/plugin
 */
"use strict";

const helpers = require("./helpers");

/**
 * Conceptual base for master and instance plugins.
 * @typedef {
 *     module:lib/plugin.BaseMasterPlugin
 *     |module:lib/plugin.BaseInstancePlugin
 *     |module:lib/plugin.BaseControlPlugin
 * } module:lib/plugin.BasePlugin
 */

/**
 * Base class for instance plugins
 *
 * Instance plugins are subclasses of this class which get instantiated by
 * the slave when it brings up an instance with the plugin enabled in the
 * config.  To be discovered the class must be exported under the name
 * `InstancePlugin` in the module specified by the `instanceEntrypoint` in
 * the plugin's info.js file.
 *
 * Instances may be started and stopped many times, and many instances may
 * be running at the same time, each of which will have their own instance
 * of the InstancePlugin class.
 *
 * @static
 */
class BaseInstancePlugin {
	constructor(info, instance, slave) {
		/**
		 * The plugin's own info module
		 */
		this.info = info;

		/**
		 * Instance the plugin started for
		 * @type {module:slave/slave~Instance}
		 */
		this.instance = instance;

		/**
		 * Slave running the instance
		 *
		 * With the exepction of accessing the slave's config you should
		 * avoid ineracting with the slave object directly.
		 *
		 * @type {module:slave/slave~Slave}
		 */
		this.slave = slave;

		/**
		 * Logger for this plugin
		 *
		 * Instance of winston Logger for sending log messages from this
		 * plugin.  Supported methods and their corresponding log levels are
		 * `error`, `warn`, `audit`, `info` and `verbose`.
		 */
		this.logger = instance.logger.child({ plugin: this.info.name });

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
	 * @param {module:lib/config.ConfigGroup} group -
	 *     The group who's field got changed on.
	 * @param {string} field - Name of the field that changed.
	 * @param {*} prev - The previous value of the field.
	 */
	async onInstanceConfigFieldChanged(group, field, prev) { }

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
	 * @returns {*} an async iterator of prometheus metric results or undefined.
	 */
	async onMetrics() { }

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
	 * @param {Object} parsed - parsed server output.
	 * @param {string} parsed.source -
	 *     Where the message came from, one of "stdout" and "stderr".
	 * @param {string} parsed.format -
	 *     Timestamp format, one of "date", "seconds" and "none".
	 * @param {string=} parsed.time -
	 *     Timestamp of the message.  Not present if format is "none".
	 * @param {string} parsed.type -
	 *     Type of message, one of "log", "action" and "generic".
	 * @param {string=} parsed.level -
	 *     Log level for "log" type.  i.e "Info" normally.
	 * @param {string=} parsed.file - File reported for "log" type.
	 * @param {string=} parsed.action -
	 *     Kind of action for "action" type. i.e "CHAT" for chat.
	 * @param {string} parsed.message - Main content of the line.
	 * @param {string} line - raw line of server output.
	 */
	async onOutput(parsed, line) { }

	/**
	 * Called when an event on the master connection happens
	 *
	 * The event param may be one of connect, drop, resume and close and has
	 * the following meaning:
	 *
	 * ##### connect
	 *
	 * Invoked when a new connection to the master has been established.
	 *
	 * ##### drop
	 *
	 * Invoked when a connection loss is detected between the slave and the
	 * master.  Plugins should respond to this event by throtteling messages
	 * it is sending to the master to an absolute minimum.
	 *
	 * Messages sent over a dropped master connection will get queued up in
	 * memory on the slave and sent all in one go when the connection is
	 * re-established again.
	 *
	 * ##### resume
	 *
	 * Invoked when the connection that had previously dropped is
	 * re-established.
	 *
	 * ##### close
	 *
	 * Invoked when the connection to the master has been closed.  This
	 * typically means the master server has shut down.  Plugins should not
	 * send any messages that goes to or via the master server after the
	 * connection has been closed and before a new one is established.
	 *
	 * @param {string} event - one of connect, drop, resume and close
	 */
	onMasterConnectionEvent(event) { }

	/**
	 * Called when the master is preparing to disconnect from the slave
	 *
	 * Invoked when the master server has requested the disconnection from
	 * the slave.  This typically happens when it is in the process of
	 * shutting down.
	 *
	 * Plugins must stop sending messages to the master, or are forwarded
	 * via the master server after the prepare disconnect has been handled.
	 *
	 * @param {module:master/src/SlaveConnection} connection -
	 *     The connection to the slave preparing to disconnect.
	 */
	async onPrepareMasterDisconnect(connection) { }

	/**
	 * Called when a player joins or leaves the game
	 *
	 * Invoked when a player either joins or leaves the instance.
	 *
	 * @param {Object} event - Information about the event.
	 * @param {string} event.type - Either "join" or "leave".
	 * @param {string} event.name - Name of the player that joined/left.
	 */
	async onPlayerEvent(event) { }

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
	 * @param {string} message - message to send to server over RCON.
	 * @param {boolean=} [expectEmpty=false] -
	 *     if true throw if the response is not empty.  Useful for detecting
	 *     errors that might have been sent in response.
	 * @returns {Promise<string>} response from server.
	 */
	async sendRcon(message, expectEmpty=false) {
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
	 * @param {string} message - message to send to server over RCON.
	 * @param {boolean=} [expectEmpty=false] -
	 *     if true throw if the response is not empty.  Useful for detecting
	 *     errors that might have been sent in response.
	 * @returns {Promise<string>} response from server.
	 */
	async sendOrderedRcon(message, expectEmpty=false) {
		let promise = new Promise((resolve, reject) => {
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
			let task = this._pendingRconMessages.shift();
			try {
				let result = await this.sendRcon(task.message, task.expectEmpty);
				task.resolve(result);
			} catch (err) {
				task.reject(err);
			}
		}
		this._sendingRconMessages = false;
	}
}

/**
 * Base class for master plugins
 *
 * Master plugins are subclasses of this class which get instantiated by
 * the master server on startup when the plugin is enabled in the config.
 * To be discovered the class must be exported under the name `MasterPlugin`
 * in the module specified by the `masterEntrypoint` in the plugin's info.js
 * file.
 *
 * @static
 */
class BaseMasterPlugin {
	constructor(info, master, metrics, logger) {
		this.info = info;

		/**
		 * Master server
		 * @type {module:master/src/Master}
		 */
		this.master = master;
		this.metrics = metrics;

		/**
		 * Logger for this plugin
		 *
		 * Instance of winston Logger for sending log messages from this
		 * plugin.  Supported methods and their corresponding log levels are
		 * `error`, `warn`, `audit`, `info` and `verbose`.
		 */
		this.logger = logger.child({ plugin: this.info.name });
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

	/**
	 * Called when the status of an instance changes
	 *
	 * Invoked when the master server has changed the status of an instance
	 * or received notice from a slave that the status of an instance has
	 * changed.  The possible statuses that can be notified about are:
	 * - `unassigned:`: Instance is no longer asssigned to a slave.
	 * - `unknown`: Slave assigned to instance is offline.
	 * - `stopped`: Instance is no longer running or was just assigned to a
	 *   slave.
	 * - `starting`: Instance is in the process of starting up.
	 * - `running`: Instance startup completed and is now running.
	 * - `stopping`: Instance is in the processing stopping.
	 * - `creating_save`: Instance is in the process of creating a save.
	 * - `exporting_data`: Instance is in the process of exporting item
	 *   icons and locale data.
	 * - `deleted`: Instance was deleted.
	 *
	 * On master startup all known instances gets the status `unknown` if
	 * they are assigned to a slave, when the slave then connects to the
	 * master and informs of the current status of its instances this hook
	 * is invoked for all those instances.  You can detect this situation by
	 * checking if prev equals `unknown`.  If the slave disconnects the
	 * instances will again get the `unknown` status.
	 *
	 * When instances are created on the master they will notify of a status
	 * change with prev set to null.  While the status of new instances is
	 * in most cases `unassigned` it's possible for the created instance to
	 * start with any state in some slave connection corner cases.
	 *
	 * Note that it's possible for status change notification to get lost in
	 * the case of network outages if reconnect fails to re-establish the
	 * session between the master server and the slave.
	 *
	 * @param {Object} instance - the instance that changed.
	 * @param {?string} prev - the previous status of the instance.
	 */
	async onInstanceStatusChanged(instance, prev) { }

	/**
	 * Called when the value of a master config field changed.
	 *
	 * Invoked after the value of the config field given by `field` has
	 * changed on the master.
	 *
	 * @param {module:lib/config.ConfigGroup} group -
	 *     The group who's field got changed on.
	 * @param {string} field - Name of the field that changed.
	 * @param {*} prev - The previous value of the field.
	 */
	async onMasterConfigFieldChanged(group, field, prev) { }

	/**
	 * Called when the value of an instance config field changed.
	 *
	 * Invoked after the value of the config field given by `field` has
	 * changed on an instance.
	 *
	 * @param {Object} instance - The instance the config changed on.
	 * @param {module:lib/config.ConfigGroup} group -
	 *     The group who's field got changed on.
	 * @param {string} field - Name of the field that changed.
	 * @param {*} prev - The previous value of the field.
	 */
	async onInstanceConfigFieldChanged(instance, group, field, prev) { }

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
	 * @returns {*} an async iterator of prometheus metric results or undefined.
	 */
	async onMetrics() { }

	/**
	 * Called when the master server is shutting down
	 */
	async onShutdown() { }

	/**
	 * Called when an event on a slave connection happens
	 *
	 * The event param may be one of connect, drop, resume and close and has
	 * the following meaning:
	 *
	 * ##### connect
	 *
	 * Invoked when a new connection to the slave has been established.
	 *
	 * ##### drop
	 *
	 * Invoked when a connection loss is detected between the master and a
	 * slave.  Plugins should respond to this event by throtteling messages
	 * it is sending to the given slave connection to an absolute minimum.
	 *
	 * Messages sent over a dropped slave connection will get queued up in
	 * memory on the master and sent all in one go when the connection is
	 * re-established again.
	 *
	 * ##### resume
	 *
	 * Invoked when a connection that had previously been dropped is
	 * re-established
	 *
	 * ##### close
	 *
	 * Invoked when the connection to the slave has been closed.
	 *
	 * @param {module:master/src/SlaveConnection} connection -
	 *     The connection the event occured on.
	 * @param {string} event - one of connect, drop, resume and close
	 */
	onSlaveConnectionEvent(connection, event) { }

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
	 * Invoked when a connection loss is detected between the master and a
	 * control.  Plugins should respond to this event by throtteling
	 * messages it is sending to the given control connection to an absolute
	 * minimum.
	 *
	 * Messages sent over a dropped control connection will get queued up in
	 * memory on the master and sent all in one go when the connection is
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
	 * @param {module:master/src/ControlConnection} connection -
	 *     The connection the event occured on.
	 * @param {string} event - one of connect, drop, resume, and close.
	 */
	onControlConnectionEvent(connection, event) { }


	/**
	 * Called when a slave is preparing to disconnect from the master
	 *
	 * Invoked when a slave has requested the disconnection from the master.
	 * This typically happens when it is in the process of shutting down.
	 *
	 * Plugins must stop sending messages to the slave in question after the
	 * prepare disconnect has been handled.
	 *
	 * @param {module:master/src/SlaveConnection} connection -
	 *     The connection to the slave preparing to disconnect.
	 */
	async onPrepareSlaveDisconnect(connection) { }

	/**
	 * Called when a player joins or leaves an instance
	 *
	 * Invoked when a player either joins or leaves an instance in the
	 * cluster.
	 *
	 * @param {Object} instance - the instance it occured on.
	 * @param {Object} event - Information about the event.
	 * @param {string} event.type - Either "join" or "leave".
	 * @param {string} event.name - Name of the player that joined/left.
	 */
	async onPlayerEvent(instance, event) { }

	/**
	 * Broadcast event to all connected slaves
	 *
	 * Sends the given event to all slaves connected to the master server.
	 * This does not include slaves that are in the process of closing the
	 * connection, which typically happens when they are shutting down.
	 *
	 * @param {module:lib/link.Event} event - Event to send
	 * @param {Object} data - Data ta pass with the event.
	 */
	broadcastEventToSlaves(event, data={}) {
		for (let slaveConnection of this.master.wsServer.slaveConnections.values()) {
			if (
				!slaveConnection.connector.closing
				&& (!event.plugin || slaveConnection.plugins.has(event.plugin))
			) {
				event.send(slaveConnection, data);
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
 *
 * @static
 */
class BaseControlPlugin {
	constructor(info, logger) {
		/**
		 * The plugin's own info module
		 */
		this.info = info;

		/**
		 * Logger for this plugin
		 *
		 * Instance of winston Logger for sending log messages from this
		 * plugin.  Supported methods and their corresponding log levels are
		 * `error`, `warn`, `audit`, `info` and `verbose`.
		 */
		this.logger = logger.child({ plugin: this.info.name });
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
	 * module:lib/command.CommandTree} to.
	 *
	 * @param {module:lib/command.CommandTree} rootCommand -
	 *     Root of the clusterioctl command tree.
	 */
	async addCommands(rootCommand) { }
}


/**
 * Plugin supplied login form
 * @typedef {Object} module:lib/plugin~LoginForm
 * @property {string} name -
 *     Internal name of the login form, this should start with the
 *     plugin name followed by a dot.
 * @property {string} title -
 *     Name displayed above this form in the login window.
 * @property {React.Component} Component -
 *     React component that's rendered for this login form.  This is
 *     supplied the setToken function via its props which should be
 *     called when an authentication token is aquired via this
 *     form.
 */

/**
 * Plugin supplied pages
 * @typedef {Object} module:Lib/plugin~Page
 * @property {string} path - URL path to this page.
 * @property {string=} sidebarPath -
 *     If present and this path matches one of the pages in the sidebar it
 *     will cause that sidebar entry to be highlighted as active.
 * @property {string=} sidebarName -
 *     If present creates an entry in the sidebar for this page with the
 *     given text.
 * @property {ReactNode} content -
 *     A react node which is rendered when this page is navigated to.
 *     Should render a PageLayout.
 */

/**
 * Base class for web interface plugins
 *
 * @static
 */
class BaseWebPlugin {
	constructor(container, packageData, info, logger) {
		/**
		 * Webpack container for this plugin
		 */
		this.container = container;

		/**
		 * Contents of the plugin's package.json file
		 * @type {Object}
		 */
		this.package = packageData;

		/**
		 * The plugin's own info module
		 */
		this.info = info;

		/**
		 * Control link to the master server, not available until the
		 * connect event in onMasterConnectionEvent is signaled.
		 * @type {?module:lib/link.Link}
		 */
		this.control = null;

		/**
		 * Logger for this plugin
		 *
		 * Instance of winston Logger for sending log messages from this
		 * plugin.  Supported methods and their corresponding log levels are
		 * `error`, `warn`, `audit`, `info` and `verbose`.
		 */
		this.logger = logger.child({ plugin: this.info.name });

		/**
		 * List of login forms provided by this plugin
		 *
		 * @type {Array<module:lib/plugin~LoginForm>}
		 */
		this.loginForms = [];

		/**
		 * List of pages provided by this plugin
		 *
		 * @type {Array<module:lib/plugin~Page>}
		 */
		this.pages = [];

		/**
		 * Extra react component to add to core components
		 *
		 * Interface to augment core components of the web UI.  Setting a
		 * component as one of the supported properties of this object will
		 * cause the web UI to render it when displaying that component,
		 * usually at the end.  Each component will receive a `plugin` param
		 * which is the instance of the web plugin that contained the
		 * component extra.
		 *
		 * @type {object}
		 * @property {React.ComponentType} MasterPage -
		 *     Placed at the end of the master page.
		 * @property {React.ComponentType} SlavesPage -
		 *     Placed at the end of the slaves list page.
		 * @property {React.ComponentType} SlaveViewPage -
		 *     Placed at the end of each slave page.  Takes a `slave` param
		 *     which is the slave the page is displayed for.
		 * @property {React.ComponentType} InstancesPage -
		 *     Placed at the end of the instance list page.
		 * @property {React.ComponentType} InstanceViewPage -
		 *     Placed at the end of each instance page.  Takes an `instance`
		 *     param which is the instance the page is displayed for.
		 * @property {React.ComponentType} UsersPage -
		 *     Placed at the end of the users list page.
		 * @property {React.ComponentType} UserViewPage -
		 *     Placed at the end of each user page.  Takes a `user` param
		 *     which is the user object the page is displayed for.
		 * @property {React.ComponentType} RolesPage -
		 *     Placed at the end of the roles list page.
		 * @property {React.ComponentType} RoleViewPage -
		 *     Placed at the end of each role page.  Takes a `role` param
		 *     which is the role object the page is displayed for.
		 */
		this.componentExtra = {};
	}

	/**
	 * Called immediately after the class is instantiated.
	 */
	async init() { }

	/**
	 * Called when an event on the master connection happens
	 *
	 * The event param may be one of connect, drop, resume and close and has
	 * the following meaning:
	 *
	 * ##### connect
	 *
	 * Invoked when a new connection to the master has been established.
	 *
	 * ##### drop
	 *
	 * Invoked when a connection loss is detected between the control link
	 * and the master.  Plugins should respond to this event by throtteling
	 * messages it is sending to the master to an absolute minimum.
	 *
	 * Messages sent over a dropped master connection will get queued up in
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
	 * Invoked when the connection to the master has been closed.  This
	 * typically means the master server has shut down.  Plugins should not
	 * send any messages that goes to or via the master server after the
	 * connection has been closed and before a new one is established.
	 *
	 * @param {string} event - one of connect, drop, resume and close
	 */
	onMasterConnectionEvent(event) { }
}

/**
 * Attach plugin messages
 *
 * Attaches all messages defined in the `.info.message` property of the
 * `plugin` passed with handlers taken from the `pluin`.
 *
 * @param {module:lib/link.Link} link - Link to attach handlers to.
 * @param {module:lib/plugin.BasePlugin} plugin -
 *     The instance of the plugin attach messages and handlers from.
 */
function attachPluginMessages(link, plugin) {
	let messageDefinitions = plugin.info.messages || [];
	for (let [name, messageFormat] of Object.entries(messageDefinitions)) {
		if (messageFormat.plugin !== plugin.info.name) {
			throw new Error(`Type of ${name} message must start with "${plugin.info.name}:"`);
		}

		let handler = name + messageFormat.handlerSuffix;
		try {
			if (plugin === null || !plugin[handler]) {
				messageFormat.attach(link);

			} else {
				messageFormat.attach(link, async (message, format) => await plugin[handler](message, format, link));
			}

		} catch (err) {
			if (err.code === "MISSING_LINK_HANDLER") {
				err.plugin = plugin.info.name;
				err.handler = handler;
			}

			throw err;
		}
	}
}

/**
 * Invokes the given hook on all plugins
 *
 * @param {Map<string, Object>} plugins -
 *     Mapping of plugin names to plugins to invoke the hook on.
 * @param {string} hook - Name of hook to invoke.
 * @param {...*} args - Arguments to pass on to the hook.
 * @returns {Array} Non-empty return values from the hooks.
 */
async function invokeHook(plugins, hook, ...args) {
	let results = [];
	for (let [name, plugin] of plugins) {
		try {
			// Use an object to detect if the hook failed on timeout or tried to return a value looking like an error
			const timeout = {};
			let result = await helpers.timeout(
				plugin[hook](...args),
				15000,
				timeout
			);
			if (result === timeout) {
				throw new Error(`Invoking hook ${hook} timed out for plugin ${name}`);
			} else if (result !== undefined) {
				results.push(result);
			}
		} catch (err) {
			plugin.logger.error(`Ignoring error from plugin ${name} in ${hook}:\n${err.stack}`);
		}
	}
	return results;
}


module.exports = {
	BaseInstancePlugin,
	BaseMasterPlugin,
	BaseControlPlugin,
	BaseWebPlugin,

	attachPluginMessages,
	invokeHook,
};
