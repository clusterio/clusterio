import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "path";
import { logger } from "./logging.js";
import * as libFileOps from "./file_ops.js";
import vm from "vm";

const corePackages = new Set([
	"@clusterio/controller",
	"@clusterio/ctl",
	"@clusterio/host",
	"@clusterio/lib",
	"@clusterio/web_ui",
]);

function isPluginPackageJson(packageJson: any): boolean {
	return Boolean(packageJson?.keywords?.includes?.("clusterio-plugin"));
}

/**
 * Read the package.json in a package directory.
 * @param packagePath - Directory of the package
 * @param tolerant - Return undefined instead of throwing if the file can't be parsed, as npm may be writing it
 * @returns The parsed package.json, or undefined if it does not exist
 */
export async function readPackageJson(packagePath: string, tolerant: boolean): Promise<any> {
	let content;
	try {
		content = await fs.readFile(path.join(packagePath, "package.json"), "utf8");
	} catch (err: any) {
		return undefined;
	}
	try {
		return JSON.parse(content);
	} catch (err: any) {
		if (tolerant) {
			return undefined;
		}
		throw err;
	}
}

/** Dependencies npm installs, an optionalDependencies entry wins over a dependencies entry of the same name */
export function installedDependencies(packageJson: any): Record<string, unknown> {
	return { ...packageJson?.dependencies, ...packageJson?.optionalDependencies };
}

/** Whether a dependency spec installs from the registry, as opposed to a path, git, url, tarball or alias */
export function isRegistrySpec(spec: unknown) {
	return typeof spec === "string" && !/[:/\\]/.test(spec) && !spec.startsWith(".")
		&& !/\.(?:tgz|tar\.gz|tar)$/i.test(spec);
}

/** Real path of a directory, used to compare packages as npm and pnpm install them behind symlinks */
export async function realDir(dir: string) {
	try {
		return await fs.realpath(dir);
	} catch {
		// Removed since, nothing else can be at this path
		return path.resolve(dir);
	}
}

/** Directory of a package as require resolves it from fromPath, or undefined if not found */
export function resolvePackagePath(packageName: string, fromPath: string, tolerant: boolean): string | undefined {
	const packageRequire = createRequire(path.join(fromPath, "package.json"));
	try {
		return path.dirname(packageRequire.resolve(`${packageName}/package.json`));
	} catch (err: any) {
		// A package.json npm is still writing fails with ERR_INVALID_PACKAGE_CONFIG
		if (tolerant || err.code === "MODULE_NOT_FOUND" || err.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
			return undefined;
		}
		throw err;
	}
}

async function pluginPathExists(pluginPath: string) {
	if (!path.isAbsolute(pluginPath)) {
		return resolvePackagePath(pluginPath, process.cwd(), true) !== undefined;
	}
	try {
		await fs.access(path.join(pluginPath, "package.json"));
		return true;
	} catch {
		return false;
	}
}

const require = createRequire(import.meta.url);
function getPluginName(requireSpec: string) {
	const context = vm.createContext({ require: require, pluginInfo: null });
	const code = `pluginInfo = require(${JSON.stringify(requireSpec)}).plugin;`;
	vm.runInContext(code, context);
	return context.pluginInfo.name;
}

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
				if (isPluginPackageJson(await readPackageJson(pluginPath, false))) {
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

type NpmPluginPackage = {
	packageName: string,
	packageVersion: unknown,
	packagePath: string,
	packageJson: any,
};

/**
 * Walk the dependencies of the root package.json and of every plugin package found, without
 * traversing packages that aren't plugins. Does not execute any plugin code.
 *
 * @param dependencies - Dependencies of the root package.json
 * @param tolerant - Skip packages with a package.json that can't be parsed instead of throwing,
 *     for use while npm may be rewriting them
 * @returns Plugin packages found, and root dependencies that are not plugins
 */
export async function discoverNpmPluginPackages(dependencies: Record<string, unknown>, tolerant = false) {
	const plugins: NpmPluginPackage[] = [];
	const nonPluginRoots: { packageName: string, packageVersion: unknown }[] = [];
	const pendingPackages = Object.entries(dependencies).map(([packageName, packageVersion]) => ({
		packageName,
		packageVersion,
		parentPath: process.cwd(),
		isRootDependency: true,
	}));
	const visitedPackages = new Set<string>();
	// Directories some dependent installs from a path, git, url, tarball or alias
	const nonRegistryDirs = new Set<string>();

	while (pendingPackages.length) {
		const { packageName, packageVersion, parentPath, isRootDependency } = pendingPackages.shift()!;
		const packagePath = resolvePackagePath(packageName, parentPath, tolerant);
		if (!packagePath) {
			continue;
		}
		if (!isRegistrySpec(packageVersion)) {
			nonRegistryDirs.add(await realDir(packagePath));
		}
		if (visitedPackages.has(packageName)) {
			continue;
		}

		visitedPackages.add(packageName);

		const packageJson = await readPackageJson(packagePath, tolerant);
		if (packageJson && isPluginPackageJson(packageJson)) {
			plugins.push({ packageName, packageVersion, packagePath, packageJson });
			for (const [dependencyName, dependencyVersion] of Object.entries(installedDependencies(packageJson))) {
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
	return { plugins, nonPluginRoots, nonRegistryDirs };
}

/** Real paths of plugin packages some dependent installs from a path, git, url, tarball or alias */
export async function findNonRegistryDirs() {
	const dependencies = installedDependencies(await readPackageJson(process.cwd(), true));
	return (await discoverNpmPluginPackages(dependencies, true)).nonRegistryDirs;
}

/** Whether npm install name would replace a plugin package not installed from the registry */
export async function isNonRegistryPackage(name: string) {
	const dependencies = installedDependencies(await readPackageJson(process.cwd(), true));
	if (Object.hasOwn(dependencies, name) && !isRegistrySpec(dependencies[name])) {
		return true;
	}
	const packagePath = resolvePackagePath(name, process.cwd(), true);
	if (!packagePath) {
		return false;
	}
	return (await findNonRegistryDirs()).has(await realDir(packagePath));
}

/**
 * Find NPM packages in the root package.json that satisfies the requirements for plugins.
 * Adds discovered plugins to the plugin list.
 *
 * @param pluginList - Map of plugin names to their file paths
 * @param skippedNpmPlugins - Filled with the package directory by plugin name for packages
 *     skipped because their plugin name was already in the list
 * @returns Promise that resolves to true if any plugins were added to the list, false otherwise
 */
async function findNpmPlugins(
	pluginList: Map<string, string>,
	skippedNpmPlugins?: Map<string, string>,
): Promise<boolean> {
	const rootPackageJson = await readPackageJson(process.cwd(), false);
	if (!rootPackageJson) {
		return false;
	}
	const dependencies = installedDependencies(rootPackageJson);

	let hasChanged = 0;
	const { plugins, nonPluginRoots } = await discoverNpmPluginPackages(dependencies);
	for (const { packageName, packageVersion, packagePath } of plugins) {
		const pluginName = getPluginName(packagePath);
		const listedPath = pluginList.get(pluginName);
		if (listedPath === packageName) {
			continue;
		}
		if (listedPath !== undefined && !await pluginPathExists(listedPath)) {
			logger.warn(`${pluginName} at ${listedPath} no longer exists, using ${packageName}`);
			pluginList.set(pluginName, packageName);
			hasChanged += 1;
		} else if (pluginList.has(pluginName)) {
			logger.warn(
				`${pluginName} provided by ${packageName}@${packageVersion} is already in the plugin list, ` +
				`but with a different path - using ${pluginList.get(pluginName)}`
			);
			skippedNpmPlugins?.set(pluginName, await realDir(packagePath));
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
 * @param skippedNpmPlugins - Filled with the package directory by plugin name for npm packages
 *     skipped because another plugin has the same name, for loadPluginInfos
 * @returns Map of plugin name to plugin path
 */
export async function loadPluginList(
	pluginListPath: string,
	findLocal = true,
	skippedNpmPlugins?: Map<string, string>,
): Promise<Map<string, string>> {
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
	hasChanges = await findNpmPlugins(pluginList, skippedNpmPlugins) || hasChanges;

	if (hasChanges) {
		await libFileOps.atomicOverwriteFile(pluginListPath, JSON.stringify([...pluginList], null, "\t"));
	}

	return pluginList;
}
