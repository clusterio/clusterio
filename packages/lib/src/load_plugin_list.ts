import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "path";
import { logger } from "./logging.js";
import * as libFileOps from "./file_ops.js";
import vm from "vm";
import { PluginDetails } from "./data/messages_plugin.js";
import type { PluginNodeEnvInfo } from "./plugin.js";

/**
 * Searches for local plugins in the plugins/ and external_plugins/ directories
 * and adds them to the plugin list if they contain a package.json file.
 *
 * @param pluginList - Map of plugin names to their file paths
 * @returns Promise that resolves to true if any plugins were added to the list, false otherwise
 */
async function findLocalPlugins(pluginList: Map<string, string>): Promise<boolean> {
	// Check folders for plugins
	const pluginFolders = [
		"plugins",
		"external_plugins",
	];

	let hasChanged = 0;
	const ignoredFolders = new Set(["node_modules", ".git", "dist", "build", "disabled"]);
	const maxDepth = 3;

	for (const pluginFolder of pluginFolders) {
		let pluginNames;
		try {
			pluginNames = await fs.readdir(pluginFolder);
		} catch (err: any) {
			if (err.code === "ENOENT") {
				// Skip if folder doesn't exist
				continue;
			}
			throw err;
		}
		for (const pluginName of pluginNames) {
			const pluginPath = path.join(pluginFolder, pluginName);
			if (pluginList.has(pluginName)) {
				// If the one in the list is not the same as this one, warn
				if (pluginList.get(pluginName) !== path.resolve(pluginPath)) {
					logger.warn(
						`${pluginName} is already in the plugin list, but with a different path - ` +
						`using ${pluginList.get(pluginName)}`
					);
				}
				continue;
			}
			const stats = await fs.stat(pluginPath);
			if (stats.isDirectory()) {
				// Check for package.json and plugin keyword
				if (await checkPackageJson(pluginPath)) {
					pluginList.set(pluginName, path.resolve(pluginPath));
					logger.info(`Added ${pluginName} from ${pluginFolder}`);
					hasChanged += 1;
					continue;
				}

				if (pluginPath.split(path.sep).length < maxDepth && !ignoredFolders.has(pluginName)) {
					logger.warn(`Possible monorepo detected, scanning ${pluginPath} for clusterio-plugins`);
					pluginFolders.push(pluginPath);
				}
			}
		}
	}

	return hasChanged > 0;
}

const require = createRequire(import.meta.url);
function getPluginName(requireSpec: string) {
	const context = vm.createContext({ require: require, pluginInfo: null });
	const code = `pluginInfo = require(${JSON.stringify(requireSpec)}).plugin;`;
	vm.runInContext(code, context);
	return context.pluginInfo.name;
}

function resolvePackagePath(packageName: string, fromPath: string): string | undefined {
	const packageRequire = createRequire(path.join(fromPath, "package.json"));
	try {
		return path.dirname(packageRequire.resolve(`${packageName}/package.json`));
	} catch (err: any) {
		if (err.code === "MODULE_NOT_FOUND" || err.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
			return undefined;
		}
		throw err;
	}
}

type NpmPluginPackage = {
	packageName: string,
	packageVersion: unknown,
	packagePath: string,
	packageJson: any,
	/** When package.json was last created or replaced, tar extraction can't set this back */
	changedAtMs: number,
};

/**
 * Read a package.json and when it last changed through one handle. Returns undefined if it's
 * missing, and if it can't be parsed when tolerant.
 */
async function readPackageSnapshot(packagePath: string, tolerant: boolean) {
	let content;
	let changedAtMs;
	try {
		const handle = await fs.open(path.join(packagePath, "package.json"), "r");
		try {
			changedAtMs = (await handle.stat()).ctimeMs;
			content = await handle.readFile("utf8");
		} finally {
			await handle.close();
		}
	} catch (err: any) {
		return undefined;
	}
	try {
		return { packageJson: JSON.parse(content), changedAtMs };
	} catch (err: any) {
		if (tolerant) {
			return undefined;
		}
		throw err;
	}
}

/**
 * Walk the dependencies of the root package.json and of every plugin package found, without
 * traversing packages that aren't plugins. Does not execute any plugin code.
 *
 * @param dependencies - Dependencies of the root package.json
 * @param tolerant - Skip packages with a package.json that can't be parsed instead of throwing,
 *     for use while npm may be rewriting them
 * @returns Plugin packages found, and root dependencies that are not plugins
 */
async function discoverNpmPluginPackages(dependencies: Record<string, unknown>, tolerant = false) {
	const plugins: NpmPluginPackage[] = [];
	const nonPluginRoots: { packageName: string, packageVersion: unknown }[] = [];
	const pendingPackages = Object.entries(dependencies).map(([packageName, packageVersion]) => ({
		packageName,
		packageVersion,
		parentPath: process.cwd(),
		isRootDependency: true,
	}));
	const visitedPackages = new Set<string>();

	while (pendingPackages.length) {
		const { packageName, packageVersion, parentPath, isRootDependency } = pendingPackages.shift()!;
		if (visitedPackages.has(packageName)) {
			continue;
		}

		const packagePath = resolvePackagePath(packageName, parentPath);
		if (!packagePath) {
			continue;
		}

		visitedPackages.add(packageName);

		const snapshot = await readPackageSnapshot(packagePath, tolerant);
		if (snapshot && isPluginPackageJson(snapshot.packageJson)) {
			plugins.push({ packageName, packageVersion, packagePath, ...snapshot });
			for (const [dependencyName, dependencyVersion] of Object.entries(snapshot.packageJson.dependencies ?? {})) {
				pendingPackages.push({
					packageName: dependencyName,
					packageVersion: dependencyVersion,
					parentPath: packagePath,
					isRootDependency: false,
				});
			}
		} else if (isRootDependency) {
			nonPluginRoots.push({ packageName, packageVersion });
		}
	}
	return { plugins, nonPluginRoots };
}

/**
 * Find NPM packages in the root package.json that satisfies the requirements for plugins.
 * Adds discovered plugins to the plugin list.
 *
 * @param pluginList - Map of plugin names to their file paths
 * @returns Promise that resolves to true if any plugins were added to the list, false otherwise
 */
async function findNpmPlugins(pluginList: Map<string, string>): Promise<boolean> {
	let dependencies;
	try {
		const rootPackageJson = JSON.parse(await fs.readFile(path.resolve("package.json"), { encoding: "utf8" }));
		dependencies = rootPackageJson.dependencies;
	} catch (err: any) {
		if (err.code === "ENOENT") {
			// Skip if package.json doesn't exist
			return false;
		}
		throw err;
	}

	if (!dependencies) {
		return false;
	}

	let hasChanged = 0;
	const { plugins, nonPluginRoots } = await discoverNpmPluginPackages(dependencies);
	for (const { packageName, packageVersion, packagePath } of plugins) {
		const pluginName = getPluginName(packagePath);
		if (pluginList.has(pluginName)) {
			logger.warn(
				`${pluginName} provided by ${packageName}@${packageVersion} is already in the plugin list, ` +
				`but with a different path - using ${pluginList.get(pluginName)}`
			);
		} else {
			pluginList.set(pluginName, packageName);
			logger.info(`Added ${pluginName} from node modules`);
			hasChanged += 1;
		}
	}
	for (const { packageName, packageVersion } of nonPluginRoots) {
		if (!corePackages.has(packageName)) {
			logger.warn(`${packageName}@${packageVersion} is not a clusterio-plugin`);
		}
	}
	return hasChanged > 0;
}

/**
 * Loads the plugin list from the specified file and optionally discovers local plugins
 *
 * @param pluginListPath - Path to the plugin list JSON file
 * @param findLocal - Whether to look for local plugins in plugins/ and external_plugins/ directories
 * @returns Map of plugin name to plugin path
 */
export async function loadPluginList(pluginListPath: string, findLocal = true): Promise<Map<string, string>> {
	let pluginList = new Map<string, string>();

	// Try to load existing plugin list
	try {
		pluginList = new Map(JSON.parse(await fs.readFile(pluginListPath, { encoding: "utf8" })));
		logger.info(`Loaded ${pluginList.size} plugins from ${pluginListPath}`);
	} catch (err: any) {
		if (err.code !== "ENOENT") {
			throw err;
		}
		logger.info(`No existing plugin list found at ${pluginListPath}`);
	}

	// Track if any changes were made
	let hasChanges = false;

	// Optionally discover local plugins
	if (findLocal) {
		hasChanges = await findLocalPlugins(pluginList) || hasChanges;
	}

	// Discover NPM plugins
	hasChanges = await findNpmPlugins(pluginList) || hasChanges;

	if (hasChanges) {
		await libFileOps.safeOutputFile(pluginListPath, JSON.stringify([...pluginList], null, "\t"));
	}

	return pluginList;
}

/**
 * Helper function to check if a package.json file exists and contains the clusterio-plugin keyword
 * @param pluginPath - Path to the plugin directory
 * @returns Promise that resolves to true if package.json exists and has clusterio-plugin keyword
 */
async function checkPackageJson(pluginPath: string): Promise<boolean> {
	const packageJsonPath = path.join(pluginPath, "package.json");

	// Read and parse package.json
	let content;
	try {
		content = await fs.readFile(packageJsonPath, { encoding: "utf8" });
	} catch (err: any) {
		return false;
	}
	return isPluginPackageJson(JSON.parse(content));
}

function isPluginPackageJson(packageJson: any): boolean {
	return Boolean(packageJson?.keywords?.includes?.("clusterio-plugin"));
}

const corePackages = new Set([
	"@clusterio/controller",
	"@clusterio/ctl",
	"@clusterio/host",
	"@clusterio/lib",
	"@clusterio/web_ui",
]);

async function realDir(dir: string) {
	try {
		return await fs.realpath(dir);
	} catch {
		return path.resolve(dir);
	}
}

async function readPackageJson(packageJsonPath: string): Promise<any> {
	try {
		return JSON.parse(await fs.readFile(packageJsonPath, { encoding: "utf8" }));
	} catch (err: any) {
		return undefined;
	}
}

/**
 * Lists the plugins on this machine along with the versions currently installed on disk,
 * including npm plugins installed since startup that will only be loaded after a restart.
 *
 * @param pluginInfos - Plugins discovered when this machine started
 * @param isLoaded - Whether the plugin is loaded
 * @param isEnabled - Whether the plugin is enabled
 * @param startedAtMs - When this machine started, packages present before that were already
 *     discovered and either loaded or ignored
 * @returns Details of every plugin on this machine
 */
export async function listPluginDetails(
	pluginInfos: PluginNodeEnvInfo[],
	isLoaded: (pluginInfo: PluginNodeEnvInfo) => boolean,
	isEnabled: (pluginInfo: PluginNodeEnvInfo) => boolean,
	startedAtMs: number,
): Promise<PluginDetails[]> {
	const plugins: PluginDetails[] = [];
	// By directory, as a plugin loaded from a path may also be an npm dependency
	const knownDirs = new Set<string>();
	for (const pluginInfo of pluginInfos) {
		knownDirs.add(await realDir(path.dirname(pluginInfo.packagePath)));
		const plugin = PluginDetails.fromNodeEnvInfo(pluginInfo, isLoaded(pluginInfo), isEnabled(pluginInfo));
		try {
			plugin.installedVersion = JSON.parse(await fs.readFile(pluginInfo.packagePath, "utf8")).version;
		} catch (err: any) {
			if (err.code === "ENOENT") {
				// Uninstalled since startup, it won't be found on the next restart
				plugin.removed = true;
			}
		}
		plugins.push(plugin);
	}

	const rootPackageJson = await readPackageJson(path.resolve("package.json"));
	const { plugins: npmPlugins } = await discoverNpmPluginPackages(rootPackageJson?.dependencies ?? {}, true);
	for (const { packageName, packagePath, packageJson, changedAtMs } of npmPlugins) {
		if (knownDirs.has(await realDir(packagePath))) {
			continue;
		}
		if (changedAtMs < startedAtMs) {
			continue; // Ignored on startup, for example because its plugin name was taken, so it won't load
		}
		if (typeof packageJson.version !== "string") {
			continue;
		}
		// Same rule as loadPluginInfos, aliases and private packages can't be installed by this name
		const npmPackage = !packageJson.private && packageJson.name === packageName ? packageName : undefined;
		plugins.push(new PluginDetails(
			packageName, packageName, packageJson.version, false, false,
			packageJson.description, npmPackage, packageJson.version, true,
		));
	}

	return plugins;
}

