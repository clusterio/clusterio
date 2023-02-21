/* eslint-disable node/global-require */
/**
 * Helpers for loading plugins in Node.js
 * @module lib/plugin_loader
 */
"use strict";

const libErrors = require("./errors");
const libPlugin = require("./plugin");
const path = require("path");


/**
 * Load plugin information
 *
 * Loads plugin info modules for the paths to the given plugins.  Once
 * loaded the info modules will not be reloaded should this function be
 * called again.
 *
 * @param {Map<string, string>} pluginList -
 *     Mapping of plugin name to require path for the plugins to load.
 * @returns {Promise<Array<Object>>} Array of plugin info modules.
 * @static
 */
async function loadPluginInfos(pluginList) {
	let plugins = [];
	for (let [pluginName, pluginPath] of pluginList) {
		let pluginInfo;
		let pluginPackage;

		try {
			pluginInfo = require(path.posix.join(pluginPath, "info"));
			pluginPackage = require(path.posix.join(pluginPath, "package.json"));

		} catch (err) {
			throw new libErrors.PluginError(pluginName, err);
		}

		if (pluginInfo.name !== pluginName) {
			throw new libErrors.EnvironmentError(
				`Expected plugin at ${pluginPath} to be named ${pluginName} but got ${pluginInfo.name}`
			);
		}

		pluginInfo.requirePath = pluginPath;
		pluginInfo.version = pluginPackage.version;
		plugins.push(pluginInfo);
	}
	return plugins;
}

function loadPluginClass(entrypointName, className, pluginClass, pluginInfo) {
	let resolvedPath = path.posix.join(pluginInfo.requirePath, pluginInfo[entrypointName]);
	let entrypoint = require(resolvedPath);
	if (!entrypoint[className]) {
		throw new libErrors.PluginError(pluginInfo.name,
			new Error(`Expected ${resolvedPath} to export a class named ${className}`)
		);
	}
	if (!(entrypoint[className].prototype instanceof pluginClass)) {
		throw new libErrors.PluginError(pluginInfo.name,
			new Error(`Expected ${className} exported from ${resolvedPath} to be a subclass of ${pluginClass.name}`)
		);
	}
	return entrypoint[className];
}

/**
 * Load controller plugin class of a plugin
 *
 * @param {Object} pluginInfo -
 *     Plugin info object returned from {@link
 *     module:lib/plugin_loader.loadPluginInfos} to load class from.
 * @returns {Promise<function>} plugin class
 * @static
 */
async function loadControllerPluginClass(pluginInfo) {
	return loadPluginClass("controllerEntrypoint", "ControllerPlugin", libPlugin.BaseControllerPlugin, pluginInfo);
}

/**
 * Load instance plugin class of a plugin
 *
 * @param {Object} pluginInfo -
 *     Plugin info object returned from {@link
 *     module:lib/plugin_loader.loadPluginInfos} to load class from.
 * @returns {Promise<function>} plugin class
 * @static
 */
async function loadInstancePluginClass(pluginInfo) {
	return loadPluginClass("instanceEntrypoint", "InstancePlugin", libPlugin.BaseInstancePlugin, pluginInfo);
}

/**
 * Load control plugin class of a plugin
 *
 * @param {Object} pluginInfo -
 *     Plugin info object returned from {@link
 *     module:lib/plugin_loader.loadPluginInfos} to load class from.
 * @returns {Promise<function>} plugin class
 * @static
 */
async function loadControlPluginClass(pluginInfo) {
	return loadPluginClass("controlEntrypoint", "ControlPlugin", libPlugin.BaseControlPlugin, pluginInfo);
}

module.exports = {
	loadPluginInfos,
	loadControllerPluginClass,
	loadInstancePluginClass,
	loadControlPluginClass,
};
