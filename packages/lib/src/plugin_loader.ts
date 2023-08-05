/* eslint-disable node/global-require */
/**
 * Helpers for loading plugins in Node.js
 * @module lib/plugin_loader
 */
import path from "path";
import * as libErrors from "./errors";
import * as libPlugin from "./plugin";
import { logger } from "./logging";


/**
 * Load plugin information
 *
 * Loads plugin info modules for the paths to the given plugins.  Once
 * loaded the info modules will not be reloaded should this function be
 * called again.
 *
 * @param pluginList -
 *     Mapping of plugin name to require path for the plugins to load.
 * @returns Array of plugin info modules.
 */
export async function loadPluginInfos(pluginList: Map<string, string>) {
	let plugins: libPlugin.PluginInfo[] = [];
	for (let [pluginName, pluginPath] of pluginList) {
		let pluginInfo: libPlugin.PluginInfo;
		let pluginPackage: { version: string };

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

		// migrate: ignore incompatible old plugins
		if (pluginInfo.messages && !(pluginInfo.messages instanceof Array)) {
			logger.warn(`Ignoring incompatible pre alpha.14 plugin ${pluginName}`);
			continue;
		}

		pluginInfo.requirePath = pluginPath;
		pluginInfo.version = pluginPackage.version;
		plugins.push(pluginInfo);
	}
	return plugins;
}

function loadPluginClass(
	entrypointName: string,
	className: string,
	pluginClass: any,
	pluginInfo: libPlugin.PluginInfo
) {
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
 * @param pluginInfo -
 *     Plugin info object returned from {@link
 *     loadPluginInfos} to load class from.
 * @returns plugin class
 */
export async function loadControllerPluginClass(
	pluginInfo: libPlugin.PluginInfo
): Promise<libPlugin.BaseControllerPlugin> {
	return loadPluginClass("controllerEntrypoint", "ControllerPlugin", libPlugin.BaseControllerPlugin, pluginInfo);
}

/**
 * Load instance plugin class of a plugin
 
 * @param pluginInfo -
 *     Plugin info object returned from {@link
 *     loadPluginInfos} to load class from.
 * @returns plugin class
 */
export async function loadInstancePluginClass(
	pluginInfo: libPlugin.PluginInfo
): Promise<libPlugin.BaseInstancePlugin> {
	return loadPluginClass("instanceEntrypoint", "InstancePlugin", libPlugin.BaseInstancePlugin, pluginInfo);
}

/**
 * Load control plugin class of a plugin
 *
 * @param pluginInfo -
 *     Plugin info object returned from {@link
 *     loadPluginInfos} to load class from.
 * @returns plugin class
 */
export async function loadControlPluginClass(
	pluginInfo: libPlugin.PluginInfo
): Promise<libPlugin.BaseControlPlugin> {
	return loadPluginClass("controlEntrypoint", "ControlPlugin", libPlugin.BaseControlPlugin, pluginInfo);
}
