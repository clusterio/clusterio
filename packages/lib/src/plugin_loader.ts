
/**
 * Helpers for loading plugins in Node.js
 * @module lib/plugin_loader
 */
import path from "path";
import fs from "fs/promises";
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
	let plugins: libPlugin.PluginNodeEnvInfo[] = [];
	for (let [pluginName, pluginPath] of pluginList) {
		let pluginInfo: libPlugin.PluginNodeEnvInfo;
		let pluginPackage: { name?: string, version: string, main?: string, private?: boolean };

		// Check if plugin path exists, otherwise remove it
		try {
			require.resolve(pluginPath);
		} catch {
			let err = `Plugin path ${pluginPath} does not exist`;
			try {
				const index = path.join(pluginPath, "index.js");
				await fs.access(pluginPath, fs.constants.F_OK);
				err = `Plugin path ${index} does not exist`;
				await fs.access(index, fs.constants.F_OK);
				err = `Plugin path ${index} is not readable`;
				await fs.access(index, fs.constants.R_OK);
				err = `Plugin path ${index} has an unknown error`;
			} catch { }
			logger.error(`${err}, not loading ${pluginName}`);
			pluginList.delete(pluginName);
			continue;
		}

		try {
			pluginInfo = require(pluginPath).plugin;
			pluginPackage = require(path.posix.join(pluginPath, "package.json"));
		} catch (err: any) {
			throw new libErrors.PluginError(pluginName, err);
		}

		if (typeof pluginInfo !== "object") {
			throw new libErrors.EnvironmentError(
				`Expected plugin at ${pluginPath} to export an object named 'plugin' but got ${typeof pluginInfo}`,
			);
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
		pluginInfo.npmPackage = !pluginPackage.private && pluginPath === pluginPackage.name ? pluginPath : undefined;
		plugins.push(pluginInfo);
	}
	return plugins;
}

export async function loadPluginClass<Class extends { new (...args: any): any }>(
	pluginName: string,
	requirePath: string,
	className: string,
	pluginClass: Class,
): Promise<Class> {
	let entrypoint = require(requirePath);
	if (!entrypoint[className]) {
		throw new libErrors.PluginError(pluginName,
			new Error(`Expected ${requirePath} to export a class named ${className}`)
		);
	}
	if (!(entrypoint[className].prototype instanceof pluginClass)) {
		throw new libErrors.PluginError(pluginName,
			new Error(`Expected ${className} exported from ${requirePath} to be a subclass of ${pluginClass.name}`)
		);
	}
	return entrypoint[className];
}
