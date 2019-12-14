"use strict";
const fs = require("fs-extra");
const path = require("path");

const errors = require("lib/errors");


/**
 * Base class for instance plugins
 */
class BaseInstancePlugin {
	constructor(info, instance) {
		this.info = info;
		this.instance = instance;
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

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
	 * Called when the instance is shutting down
	 */
	async onExit() { }

	/**
	 * Called when the Factorio outputs a line
	 *
	 * Called when the Factorio server outputs a line on either stdout or
	 * stderr.  The output is a parsed form of the line and contains the
	 * following properties (those marked with ? are optional):
	 *
	 * - source: Where the message came from, one of "stdout" and "stderr".
	 * - format: Timestamp format, one of "date", "seconds" and "none".
	 * - time?: Timestamp of the message.  Not present if format is "none".
	 * - type: Type of message, one of "log", "action" and "generic".
	 * - level?: Log level for "log" type.  i.e "Info" normally.
	 * - file?: File reported for "log" type.
	 * - action?: Kind of action for "action" type. i.e "CHAT" for chat.
	 * - message: Main content of the line.
	 */
	async onOutput(output) { }
}

class BaseMasterPlugin {
	constructor(info) {
		this.info = info;
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

	/**
	 * Called when the master server is shutting down
	 */
	async onExit() { }
}

async function getPluginInfos(baseDir) {
	let plugins = [];
	for (let pluginDir of await fs.readdir(baseDir)) {
		let pluginInfo;

		try {
			// Note: Require path is relative to this module
			pluginInfo = require(path.posix.join('..', baseDir, pluginDir, 'info'));

		} catch (err) {
			if (err.code === 'MODULE_NOT_FOUND') {
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

		pluginInfo.enabled = !await fs.exists(path.join(baseDir, pluginDir, "DISABLED"));
		plugins.push(pluginInfo);
	}
	return plugins;
}

function attachPluginMessages(link, pluginInfo, plugin) {
	let messageDefinitions = pluginInfo.messages || [];
	for (let [name, messageFormat] of Object.entries(messageDefinitions)) {
		let handler = name + messageFormat.constructor.name + 'Handler';
		if (plugin === null || !plugin[handler]) {
			messageFormat.attach(link);

		} else {
			messageFormat.attach(link, async function(message, format) {
				return await plugin[handler](message, format, this);
			});
		}
	}
}


module.exports = {
	BaseInstancePlugin,
	BaseMasterPlugin,

	getPluginInfos,
	attachPluginMessages,
};
