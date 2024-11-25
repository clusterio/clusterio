import fs from "fs-extra";
import path from "path";
import { logger } from "./logging";
import * as libFileOps from "./file_ops";

/**
 * Find local plugins to add to the plugin list. This is primarily used during development.
 */
async function findLocalPlugins(pluginList: Map<string, string>, pluginListPath: string) {
	// Check folders for plugins
	const pluginFolders = [
		path.join(process.cwd(), "plugins"),
		path.join(process.cwd(), "external_plugins"),
	];

	let has_changed = 0;
	for (const pluginFolder of pluginFolders) {
		const pluginNames = await fs.readdir(pluginFolder);
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
			console.log(`Adding ${pluginName} from ${pluginFolder}`);

			pluginList.set(pluginName, pluginPath);
			logger.info(`Added ${pluginName} from ${pluginFolder}`);
			has_changed++;
		}
	}

	if (has_changed > 0) {
		await libFileOps.safeOutputFile(pluginListPath, JSON.stringify([...pluginList], null, "\t"));
	}
}

/**
 * Find NPM packages in the root package.json that satisfies the requirements for plugins.
 */
async function findNpmPlugins(pluginList: Map<string, string>, pluginListPath: string) {
	const rootPackageJson = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "package.json"), { encoding: "utf8" }));
	const dependencies = rootPackageJson.dependencies;

	let changed = 0;
	for (const [pluginName, pluginVersion] of Object.entries(dependencies)) {
		if (pluginList.has(pluginName)) {
			console.log(`${pluginName} already exists`);
			continue;
		}
		// Find the package in node_modules and read the package.json
		const packageJsonPath = path.resolve(process.cwd(), "node_modules", pluginName, "package.json");
		const packageJson = JSON.parse(await fs.readFile(packageJsonPath, { encoding: "utf8" }));
		// Check if the package has the "clusterio-plugin" keyword
		if (packageJson.keywords?.includes("clusterio-plugin")) {
			const pluginInfo = require(path.resolve(process.cwd(), "node_modules", pluginName)).plugin;
			pluginList.set(pluginInfo.name, pluginName);
			logger.info(`Added ${pluginInfo.name} from NPM`);
			changed++;
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

	// Optionally discover NPM plugins
	await findNpmPlugins(pluginList, pluginListPath);

	return pluginList;
}
