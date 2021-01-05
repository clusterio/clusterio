/* eslint-disable global-require */
/**
 * Helpers for loading plugins in Node.js
 * @module lib/plugin_loader
 */
"use strict";

const libErrors = require("@clusterio/lib/errors");
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
 * @returns {Array<Object>} Array of plugin info modules.
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

/**
 * Load master plugin class of a plugin
 *
 * @param {Object} pluginInfo -
 *     Plugin info object returned from {@link
 *     module:lib/plugin_loader.loadPluginInfos} to load class from.
 * @returns {function} plugin class
 * @static
 */
async function loadMasterPluginClass(pluginInfo) {
	let entrypoint = require(path.posix.join(pluginInfo.requirePath, pluginInfo.masterEntrypoint));
	return entrypoint.MasterPlugin;
}

/**
 * Load instance plugin class of a plugin
 *
 * @param {Object} pluginInfo -
 *     Plugin info object returned from {@link
 *     module:lib/plugin_loader.loadPluginInfos} to load class from.
 * @returns {function} plugin class
 * @static
 */
async function loadInstancePluginClass(pluginInfo) {
	let entrypoint = require(path.posix.join(pluginInfo.requirePath, pluginInfo.instanceEntrypoint));
	return entrypoint.InstancePlugin;
}

/**
 * Load control plugin class of a plugin
 *
 * @param {Object} pluginInfo -
 *     Plugin info object returned from {@link
 *     module:lib/plugin_loader.loadPluginInfos} to load class from.
 * @returns {function} plugin class
 * @static
 */
async function loadControlPluginClass(pluginInfo) {
	let entrypoint = require(path.posix.join(pluginInfo.requirePath, pluginInfo.controlEntrypoint));
	return entrypoint.ControlPlugin;
}

module.exports = {
	loadPluginInfos,
	loadMasterPluginClass,
	loadInstancePluginClass,
	loadControlPluginClass,
};
