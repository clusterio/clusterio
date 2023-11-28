/* eslint-disable @typescript-eslint/no-var-requires */
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
	let plugins: libPlugin.PluginNodeEnvInfo[] = [];
	for (let [pluginName, pluginPath] of pluginList) {
		let pluginInfo: libPlugin.PluginNodeEnvInfo;
		let pluginPackage: { name?: string, version: string, main?: string, private?: boolean };

		try {
			pluginInfo = require(pluginPath).default;
			pluginPackage = require(path.posix.join(pluginPath, "package.json"));
		} catch (err: any) {
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
