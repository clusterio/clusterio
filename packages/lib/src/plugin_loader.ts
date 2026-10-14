
/**
 * Helpers for loading plugins in Node.js
 * @module lib/plugin_loader
 */
import path from "path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as libErrors from "./errors.js";
import * as libPlugin from "./plugin.js";
import { type Logger, logger } from "./logging.js";
import { loadPluginEntrypoint, loadPluginClass } from "./loadPlugin.js";
import { ControllerConfig, HostConfig, InstanceConfig } from "./config/definitions.js";
import Role from "./data/Role.js";


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
		let packagePath;

		// Check if plugin has a package.json file, otherwise remove it
		try {
			const absolute = path.isAbsolute(pluginPath);
			const packageImport = path.posix.join(pluginPath, "package.json");
			packagePath = fileURLToPath(import.meta.resolve(
				absolute ? pathToFileURL(packageImport).href : packageImport
			));
			await fs.access(packagePath, fs.constants.F_OK);
		} catch (err) {
			let errMsg = `Plugin path ${pluginPath} does not exist`;
			try {
				await fs.access(pluginPath, fs.constants.F_OK);
				errMsg = `Plugin path ${pluginPath} missing index or main file`;
			} catch {}
			logger.error(`${errMsg}, not loading ${pluginName}`);
			pluginList.delete(pluginName);
			continue;
		}

		try {
			pluginPackage = (await import(pathToFileURL(packagePath).href, { with: { type: "json" }})).default;
			// pluginPath is a package name for plugins installed from npm, so resolve from the package itself
			pluginInfo = (await import(
				pathToFileURL(path.join(path.dirname(packagePath), pluginPackage.main ?? "index.js")).href
			)).plugin;
		} catch (err: any) {
			if (err.code === "InstallationError") {
				throw err;
			}
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

		pluginInfo.webStaticPath = path.join(path.dirname(packagePath), "dist", "web", "static");
		pluginInfo.packagePath = packagePath;
		pluginInfo.requirePath = pluginPath;
		pluginInfo.version = pluginPackage.version;
		pluginInfo.npmPackage = !pluginPackage.private && pluginPath === pluginPackage.name ? pluginPath : undefined;
		plugins.push(pluginInfo);
	}
	return plugins;
}

/**
 * Load the migration entrypoints of plugins
 *
 * Must be called before configs and roles are loaded for the migrations
 * to run on them. Loaded for every plugin, including those disabled with
 * load_plugin.
 *
 * @param pluginInfos - Plugins to load migrations for.
 */
export async function loadPluginMigrations(pluginInfos: libPlugin.PluginNodeEnvInfo[]) {
	const hooks: libPlugin.MigrationHooks = {
		controllerConfig: ControllerConfig.pluginMigrations,
		hostConfig: HostConfig.pluginMigrations,
		instanceConfig: InstanceConfig.pluginMigrations,
		role: Role.pluginMigrations,
	};

	for (const pluginInfo of pluginInfos) {
		if (!pluginInfo.migrationEntrypoint) {
			continue;
		}

		try {
			const module = await import(pathToFileURL(
				path.join(path.dirname(pluginInfo.packagePath), pluginInfo.migrationEntrypoint)
			).href);
			const context: libPlugin.MigrationContext = {
				hooks,
				plugin: pluginInfo,
				logger: logger.child({ plugin: pluginInfo.name }),
			};
			await loadPluginEntrypoint(pluginInfo, "migration", context, module);
		} catch (err: any) {
			throw new libErrors.PluginError(pluginInfo.name, err);
		}
	}
}

export async function loadPlugin<
	Context extends { logger: Logger },
	Class extends libPlugin.PluginClass<Context, libPlugin.PluginNodeEnvInfo>,
> (
	pluginInfo: libPlugin.PluginNodeEnvInfo,
	pluginType: libPlugin.PluginType,
	context: Context,
	exportName: `${string}Plugin`,
	baseClass: Class,
) {
	const entrypoint = `${pluginType}Entrypoint` as const;
	const requirePath = pluginInfo[entrypoint];

	if (!requirePath) {
		return;
	}

	const module = await import(pathToFileURL(path.join(path.dirname(pluginInfo.packagePath), requirePath)).href);
	const pluginContext: libPlugin.PluginLoadContext<Context> = {
		...context,
		plugin: pluginInfo,
		logger: context.logger.child({ plugin: pluginInfo.name }),
	};

	if (typeof module.default === "function") {
		await loadPluginEntrypoint(pluginInfo, pluginType, pluginContext, module);
		return;
	}

	// migrate: accept plugins which export classes
	if (module[exportName]) {
		pluginContext.logger.warn(`Plugin ${pluginInfo.name} is using deprecated class export`);
		await loadPluginClass(pluginInfo, pluginType, pluginContext, module, exportName, baseClass);
		return;
	}

	throw new Error(`Plugin ${pluginInfo.name} must export either a default function or ${exportName} class`);
}
