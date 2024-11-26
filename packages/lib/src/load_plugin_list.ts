import fs from "fs-extra";
import path from "path";
import { logger } from "./logging";
import * as libFileOps from "./file_ops";

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
			if (pluginList.has(pluginName)) {
				continue;
			}
			const pluginPath = path.resolve(pluginFolder, pluginName);
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
	for (const [pluginName, pluginVersion] of Object.entries(dependencies)) {
		if (pluginList.has(pluginName)) {
			continue;
		}
		// Find the package in node_modules and read the package.json
		const packageJsonPath = path.resolve("node_modules", pluginName, "package.json");
		const packageJson = JSON.parse(await fs.readFile(packageJsonPath, { encoding: "utf8" }));
		// Check if the package has the "clusterio-plugin" keyword
		if (packageJson.keywords?.includes("clusterio-plugin")) {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const pluginInfo = require(path.resolve("node_modules", pluginName)).plugin;
			pluginList.set(pluginInfo.name, pluginName);
			logger.info(`Added ${pluginInfo.name} from NPM`);
			changed += 1;
		} else {
			logger.info(`${pluginName}@${pluginVersion} is not a clusterio-plugin`);
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
