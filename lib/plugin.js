/**
 * Plugin interfaces and utilities.
 * @module
 */
"use strict";
const fs = require("fs-extra");
const path = require("path");

const errors = require("lib/errors");


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
		 * @type {module:slave~Instance}
		 */
		this.instance = instance;

		/**
		 * Slave running the instance
		 *
		 * With the exepction of accessing the slave's config you should
		 * avoid ineracting with the slave object directly.
		 *
		 * @type {module:slave~Slave}
		 */
		this.slave = slave;
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
	 * @param {Object} output - parsed server output.
	 * @param {string} output.source -
	 *     Where the message came from, one of "stdout" and "stderr".
	 * @param {string} output.format -
	 *     Timestamp format, one of "date", "seconds" and "none".
	 * @param {string=} output.time -
	 *     Timestamp of the message.  Not present if format is "none".
	 * @param {string} output.type -
	 *     Type of message, one of "log", "action" and "generic".
	 * @param {string=} output.level -
	 *     Log level for "log" type.  i.e "Info" normally.
	 * @param {string=} output.file - File reported for "log" type.
	 * @param {string=} output.action -
	 *     Kind of action for "action" type. i.e "CHAT" for chat.
	 * @param {string} output.message - Main content of the line.
	 */
	async onOutput(output) { }

	/**
	 * Called when an event on the master connection happens
	 *
	 * The event param may be one of connect, drop and close and has the
	 * following meaning:
	 *
	 * ##### connect
	 *
	 * Invoked when a new connection to the master has been established, or
	 * the existing one that have previously been dropped is re-established.
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
	 * ##### close
	 *
	 * Invoked when the connection to the master has been closed.  This
	 * typically means the master server has shut down.  Plugins should not
	 * send any messages that goes to or via the master server after the
	 * connection has been closed and before a new one is established.
	 *
	 * @param {string} event - one of connect, drop, and close
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
	 * @param {module:master~SlaveConnection} connection -
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
	constructor(info, master, metrics) {
		this.info = info;
		this.master = master;
		this.metrics = metrics;
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

	/**
	 * Called when the status of an instance changes
	 *
	 * Invoked when the master server has received notice from a slave that
	 * the running status of an instance has changed.  The possible statuses
	 * are `stopped` meaning it is not loaded or running, `initialized`
	 * meaning the instance has initialized and is starting up the Factorio
	 * server, and `running` which means the Factorio server it manages is
	 * up and running.
	 *
	 * @param {Object} instance - the instance that changed.
	 * @param {string} prev - the previous status of the instance.
	 */
	async onInstanceStatusChanged(instance, prev) { }

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
	 * The event param may be one of connect, drop and close and has the
	 * following meaning:
	 *
	 * ##### connect
	 *
	 * Invoked when a new connection to the slave has been established, or
	 * an existing one that had previously been dropped is re-established.
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
	 * ##### close
	 *
	 * Invoked when the connection to the slave has been closed.
	 *
	 * @param {module:master~SlaveConnection} connection -
	 *     The connection the event occured on.
	 * @param {string} event - one of connect, drop, and close
	 */
	onSlaveConnectionEvent(connection, event) { }

	/**
	 * Called when a slave is preparing to disconnect from the master
	 *
	 * Invoked when a slave has requested the disconnection from the master.
	 * This typically happens when it is in the process of shutting down.
	 *
	 * Plugins must stop sending messages to the slave in question after the
	 * prepare disconnect has been handled.
	 *
	 * @param {module:master~SlaveConnection} connection -
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
		for (let slaveConnection of this.master.slaveConnections.values()) {
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
 * Base class for clusterctl plugins
 *
 * Control plugins are subclasses of this class which get instantiated by
 * clusterctl in order to extend its functionallity.  To be discovered the
 * class must be exported under the name `ControlPlugin` in the module
 * specified by the `controlEntrypoint` in the plugin's info.js file.
 *
 * @static
 */
class BaseControlPlugin {
	constructor(info) {
		/**
		 * The plugin's own info module
		 */
		this.info = info;
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

	/**
	 * Called to add commands to the command line interface.
	 *
	 * Invoked by clusterctl to let plugins add commands.  `rootCommand` is
	 * the top level command node which the plugin should add its own {@link
	 * module:lib/command.CommandTree} to.
	 *
	 * @param {module:lib/command.CommandTree} rootCommand -
	 *     Root of the clusterctl command tree.
	 */
	async addCommands(rootCommand) { }
}

/**
 * Load plugin information
 *
 * Searches through the plugin directory and loads each plugin's info
 * module.  Once loaded the info modules will not be reloaded should this
 * function be called again.
 *
 * @param {string} baseDir - posix relative path to plugin directory.
 * @returns {Map<string, Object>} mapping of plugin name to info module.
 * @static
 */
async function loadPluginInfos(baseDir) {
	let plugins = [];
	for (let pluginDir of await fs.readdir(baseDir)) {
		let pluginInfo;

		try {
			// Note: Require path is relative to this module
			pluginInfo = require(path.posix.join("..", baseDir, pluginDir, "info"));

		} catch (err) {
			if (err.code === "MODULE_NOT_FOUND") {
				continue;
			} else {
				throw new errors.PluginError(pluginDir, err);
			}
		}

		if (pluginInfo.name !== pluginDir) {
			throw new errors.EnvironmentError(
				`Plugin dir ${baseDir}/${pluginDir} does not match the name of the plugin (${pluginInfo.name})`
			);
		}

		plugins.push(pluginInfo);
	}
	return plugins;
}

/**
 * Attach plugin messages
 *
 * Attaches all messages defined in the `.message` property of the
 * `pluginInfo` passed with handlers taken from `pluin`.
 *
 * @param {module:lib/link.Link} link - Link to attach handlers to.
 * @param {object} pluginInfo - Plugin info object.
 * @param {module:lib/plugin.BasePlugin} plugin -
 *     The instance of the plugin to use handlers from.
 */
function attachPluginMessages(link, pluginInfo, plugin) {
	let messageDefinitions = pluginInfo.messages || [];
	for (let [name, messageFormat] of Object.entries(messageDefinitions)) {
		if (messageFormat.plugin !== pluginInfo.name) {
			throw new Error(`Type of ${name} message must start with "${pluginInfo.name}:"`);
		}

		let handler = name + messageFormat.constructor.name + "Handler";
		if (plugin === null || !plugin[handler]) {
			messageFormat.attach(link);

		} else {
			messageFormat.attach(link, async function(message, format) {
				return await plugin[handler](message, format, this);
			});
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
			let result = await plugin[hook](...args);
			if (result !== undefined) {
				results.push(result);
			}
		} catch (err) {
			console.error(`Ignoring error from plugin ${name} in ${hook}:`, err);
		}
	}
	return results;
}


module.exports = {
	BaseInstancePlugin,
	BaseMasterPlugin,
	BaseControlPlugin,

	loadPluginInfos,
	attachPluginMessages,
	invokeHook,
};
