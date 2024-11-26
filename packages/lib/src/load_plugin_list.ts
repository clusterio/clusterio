import fs from "fs-extra";
import path from "path";
import { logger } from "./logging";
import * as libFileOps from "./file_ops";
import vm from "vm";

/**
 * Searches for local plugins in the plugins/ and external_plugins/ directories
 * and adds them to the plugin list if they contain a package.json file.
 *
 * @param pluginList - Map of plugin names to their file paths
 * @param pluginListPath - Path to the JSON file storing the plugin list
 * @returns Promise that resolves when plugin discovery is complete
 */
async function findLocalPlugins(pluginList: Map<string, string>, pluginListPath: string) {
	// Check folders for plugins
	const pluginFolders = [
		"plugins",
		"external_plugins",
	];

	let has_changed = 0;
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
			const pluginPath = path.resolve(pluginFolder, pluginName);
			if (pluginList.has(pluginName)) {
				// If the one in the list is not the same as this one, warn
				if (pluginList.get(pluginName) !== pluginPath) {
					logger.warn(`${pluginName} is already in the plugin list, but with a different path - using ${pluginList.get(pluginName)}`);
				}
				continue;
			}
			const stats = await fs.stat(pluginPath);
			if (!stats.isDirectory()) {
				continue;
			}

			// Check that the plugin has a package.json file
			const packageJsonPath = path.resolve(pluginPath, "package.json");
			if (!(await fs.exists(packageJsonPath))) {
				continue;
			}

			pluginList.set(pluginName, pluginPath);
			logger.info(`Added ${pluginName} from ${pluginFolder}`);
			has_changed += 1;
		}
	}

	if (has_changed > 0) {
		await libFileOps.safeOutputFile(pluginListPath, JSON.stringify([...pluginList], null, "\t"));
	}
}

function getPluginName(requireSpec: string) {
	const context = vm.createContext({ require: require });
	const code = `const pluginInfo = require(${JSON.stringify(requireSpec)}).plugin;`;
	vm.runInContext(code, context);
	return context.pluginInfo.name;
}

/**
 * Find NPM packages in the root package.json that satisfies the requirements for plugins.
 *
 * @param pluginList - Map of plugin names to their file paths
 * @param pluginListPath - Path to the JSON file storing the plugin list
 * @returns Promise that resolves when plugin discovery is complete
 */
async function findNpmPlugins(pluginList: Map<string, string>, pluginListPath: string) {
	let dependencies;
	try {
		const rootPackageJson = JSON.parse(await fs.readFile(path.resolve("package.json"), { encoding: "utf8" }));
		dependencies = rootPackageJson.dependencies;
	} catch (err: any) {
		if (err.code === "ENOENT") {
			// Skip if package.json doesn't exist
			return;
		}
		throw err;
	}

	let changed = 0;
	for (const [packageName, packageVersion] of Object.entries(dependencies)) {
		if ([...pluginList.values()].includes(packageName)) {
			continue; // This npm module is already in the plugin list
		}
		// Find the package in node_modules and read the package.json
		const packageJsonPath = path.resolve("node_modules", packageName, "package.json");
		const packageJson = JSON.parse(await fs.readFile(packageJsonPath, { encoding: "utf8" }));
		// Check if the package has the "clusterio-plugin" keyword
		if (packageJson.keywords?.includes("clusterio-plugin")) {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const pluginName = getPluginName(path.resolve("node_modules", packageName));
			if (pluginList.has(pluginName)) {
				logger.warn(
					`${pluginName} provided by ${packageName}@${packageVersion} is already in the plugin list, ` +
					`but with a different path - using ${pluginList.get(pluginName)}`
				);
			} else {
				pluginList.set(pluginName, packageName);
				logger.info(`Added ${pluginName} from NPM`);
				changed += 1;
			}
		} else if (![
			"@clusterio/controller",
			"@clusterio/ctl",
			"@clusterio/host",
			"@clusterio/lib",
			"@clusterio/web_ui",
		].includes(packageName)) {
			logger.warn(`${packageName}@${packageVersion} is not a clusterio-plugin`);
		}
	}
	if (changed > 0) {
		await libFileOps.safeOutputFile(pluginListPath, JSON.stringify([...pluginList], null, "\t"));
	}
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

	// Optionally discover local plugins
	if (findLocal) {
		await findLocalPlugins(pluginList, pluginListPath);
	}

	// Discover NPM plugins
	await findNpmPlugins(pluginList, pluginListPath);

	return pluginList;
}
