
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
import { Config } from "./config/classes.js";
import { ControllerConfig, HostConfig, InstanceConfig } from "./config/definitions.js";
import Role from "./data/Role.js";
import { PluginDetails } from "./data/messages_plugin.js";
import {
	discoverNpmPluginPackages, findNonRegistryDirs, installedDependencies, readPackageJson, realDir, resolvePackagePath,
} from "./load_plugin_list.js";


/**
 * Load plugin information
 *
 * Loads plugin info modules for the paths to the given plugins.  Once
 * loaded the info modules will not be reloaded should this function be
 * called again.
 *
 * @param pluginList -
 *     Mapping of plugin name to require path for the plugins to load.
 * @param skippedNpmPlugins -
 *     Directory of the npm package skipped by plugin name, from loadPluginList.
 * @returns Array of plugin info modules.
 */
export async function loadPluginInfos(pluginList: Map<string, string>, skippedNpmPlugins?: Map<string, string>) {
	let plugins: libPlugin.PluginNodeEnvInfo[] = [];
	const nonRegistryDirs = await findNonRegistryDirs();
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
		pluginInfo.npmPackage = !pluginPackage.private && pluginPath === pluginPackage.name
			&& !nonRegistryDirs.has(await fs.realpath(path.dirname(packagePath))) ? pluginPath : undefined;
		pluginInfo.skippedNpmPackage = skippedNpmPlugins?.get(pluginName);
		plugins.push(pluginInfo);
	}
	return plugins;
}

/**
 * Lists the plugins on this machine along with the versions currently installed on disk,
 * including npm plugins installed since startup that will only be loaded after a restart.
 *
 * @param pluginInfos - Plugins discovered when this machine started
 * @param isLoaded - Whether the plugin is loaded
 * @param isEnabled - Whether the plugin is enabled
 * @param hasEntrypoint - Whether the plugin has an entrypoint this machine loads
 * @returns Details of every plugin on this machine
 */
export async function listPluginDetails(
	pluginInfos: libPlugin.PluginNodeEnvInfo[],
	isLoaded: (pluginInfo: libPlugin.PluginNodeEnvInfo) => boolean,
	isEnabled: (pluginInfo: libPlugin.PluginNodeEnvInfo) => boolean,
	hasEntrypoint: (pluginInfo: libPlugin.PluginNodeEnvInfo) => boolean = () => true,
): Promise<PluginDetails[]> {
	const plugins: PluginDetails[] = [];
	const dependencies = installedDependencies(await readPackageJson(process.cwd(), true));
	// By directory, as a plugin loaded from a path may also be an npm dependency
	const knownDirs = new Set<string>();
	// Packages skipped on startup by directory, for plugins still installed
	const takenDirs = new Set<string>();
	const { plugins: npmPlugins, nonRegistryDirs } = await discoverNpmPluginPackages(dependencies, true);
	for (const pluginInfo of pluginInfos) {
		const dir = await realDir(path.dirname(pluginInfo.packagePath));
		knownDirs.add(dir);
		const loaded = isLoaded(pluginInfo);
		// Without an entrypoint for this machine the plugin has no load_plugin field here
		const plugin = PluginDetails.fromNodeEnvInfo(
			pluginInfo,
			hasEntrypoint(pluginInfo) ? PluginDetails.loadState(loaded, isEnabled(pluginInfo)) : "noEntrypoint",
		);
		if (Object.hasOwn(dependencies, pluginInfo.requirePath)) {
			plugin.dependencyName = pluginInfo.requirePath;
		}
		if (nonRegistryDirs.has(dir)) {
			plugin.npmPackage = undefined;
		}
		let packageJson;
		try {
			packageJson = await readPackageJson(path.dirname(pluginInfo.packagePath), false);
			if (packageJson === undefined) {
				// Uninstalled since startup, it won't be found on the next restart
				plugin.state = loaded ? "removedLoaded" : "removed";
			}
		} catch {
			// Ignored: npm is still writing it
		}
		if (packageJson) {
			plugin.installedVersion = packageJson.version;
			if (packageJson.name !== plugin.npmPackage) {
				// Replaced by an alias since startup
				plugin.npmPackage = undefined;
			}
		}
		if (!plugin.removed && pluginInfo.skippedNpmPackage !== undefined) {
			takenDirs.add(pluginInfo.skippedNpmPackage);
		}
		plugins.push(plugin);
	}

	for (const { packageName, packagePath, packageJson } of npmPlugins) {
		const dir = await realDir(packagePath);
		if (knownDirs.has(dir)) {
			continue;
		}
		// Startup loads it by package name from the root, which doesn't reach nested packages
		const rootPath = resolvePackagePath(packageName, process.cwd(), true);
		if (!rootPath || await realDir(rootPath) !== dir) {
			continue;
		}
		if (typeof packageJson.version !== "string") {
			continue;
		}
		// Same rule as loadPluginInfos, aliases, private and non-registry packages can't be installed by this name
		const npmPackage = !packageJson.private && packageJson.name === packageName && !nonRegistryDirs.has(dir)
			? packageName : undefined;
		const dependencyName = Object.hasOwn(dependencies, packageName) ? packageName : undefined;
		const plugin = PluginDetails.fromPackageJson(packageName, packageJson, npmPackage, dependencyName);
		if (takenDirs.has(dir)) {
			// Skipped on startup as its plugin name is taken, will be again
			plugin.state = "nameTaken";
		}
		plugins.push(plugin);
	}

	return plugins;
}

/**
 * Load the migration entrypoints of plugins
 *
 * Must be called before configs and roles are loaded for the migrations
 * to run on them. Loaded for every plugin, including those disabled with
 * load_plugin. Also registers the plugin versions written to each config
 * after the migrations run.
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
		Config.pluginVersions.set(pluginInfo.name, pluginInfo.version);
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
