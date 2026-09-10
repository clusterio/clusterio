// Implementation of the create-scenario command
import fs from "node:fs/promises";
import os from "node:os";
import JSZip from "jszip";
import path from "path";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

import { loadModules, patch, SaveModule } from "./patch";
import { findVersion } from "./server";


/**
 * Create a scenario patched with the given modules
 *
 * Runs the save patching on the scenario at scenarioPath and writes the
 * result to the directory at outputPath.  The scenario can be a directory,
 * a zipped scenario or a save.
 *
 * @param scenarioPath - Path to the scenario to patch.
 * @param outputPath - Directory to write the patched scenario to.
 * @param modules - Description of the modules to patch.
 */
export async function createScenario(scenarioPath: string, outputPath: string, modules: SaveModule[]) {
	if (await fs.access(outputPath).then(() => true, () => false)) {
		throw new Error(`${outputPath} already exists`);
	}

	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clusterio-scenario-"));
	try {
		const tempPath = path.join(tempDir, "scenario.zip");
		if ((await fs.stat(scenarioPath)).isDirectory()) {
			await zipDirectory(scenarioPath, tempPath);
		} else {
			await fs.copyFile(scenarioPath, tempPath);
		}

		await patch(tempPath, modules);
		await extractZip(tempPath, outputPath);
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}

async function zipDirectory(dirPath: string, zipPath: string) {
	const root = path.basename(path.resolve(dirPath));
	const zip = new JSZip();
	let dirs: [string, string][] = [[dirPath, root]];
	while (dirs.length) {
		let [dir, relativeDir] = dirs.pop()!;
		for (let entry of await fs.readdir(dir, { withFileTypes: true })) {
			let fsPath = path.join(dir, entry.name);
			let relativePath = path.posix.join(relativeDir, entry.name);
			if (entry.isFile()) {
				zip.file(relativePath, await fs.readFile(fsPath));
			} else if (entry.isDirectory()) {
				dirs.push([fsPath, relativePath]);
			}
		}
	}
	await fs.writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
}

async function extractZip(zipPath: string, dirPath: string) {
	const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
	const root = lib.findRoot(zip);
	for (let file of Object.values(zip.files)) {
		if (file.dir || !file.name.startsWith(`${root}/`)) {
			continue;
		}
		const fsPath = path.join(dirPath, file.name.slice(root.length + 1));
		await fs.mkdir(path.dirname(fsPath), { recursive: true });
		await fs.writeFile(fsPath, await file.async("nodebuffer"));
	}
}

/**
 * Yargs create-scenario command
 *
 * @param yargs - yargs command builder.
 */
export function createScenarioCommand(yargs: any) {
	yargs
		.positional("output", {
			describe: "Directory to write the scenario to",
			type: "string",
		})
		.option("scenario", {
			nargs: 1,
			describe: "Scenario directory, zipped scenario or save to patch, defaults to freeplay",
			type: "string",
		})
		.option("factorio-version", {
			nargs: 1,
			describe: "Factorio version to take the freeplay scenario from",
			default: "latest",
			type: "string",
		})
		.option("plugins", {
			describe: "Plugins to patch modules from, defaults to all plugins enabled in the host config",
			type: "array",
		})
	;
}

/**
 * Handle yargs create-scenario command
 *
 * @param args - yargs args object.
 * @param hostConfig - Host config.
 * @param pluginInfos - Plugins available to the host.
 */
export async function handleCreateScenarioCommand(
	args: Record<string, unknown>,
	hostConfig: lib.HostConfig,
	pluginInfos: lib.PluginNodeEnvInfo[],
) {
	let selected: lib.PluginNodeEnvInfo[];
	if (args.plugins) {
		selected = (args.plugins as string[]).map(name => {
			const pluginInfo = pluginInfos.find(info => info.name === name);
			if (!pluginInfo) {
				throw new Error(`Plugin ${name} is not in the plugin list`);
			}
			return pluginInfo;
		});
	} else {
		selected = pluginInfos.filter(
			info => info.instanceEntrypoint && hostConfig.get(`${info.name}.load_plugin`)
		);
	}

	let scenarioPath = args.scenario as string | undefined;
	if (scenarioPath === undefined) {
		const factorioDir = hostConfig.get("host.factorio_directory");
		const version = args.factorioVersion as lib.TargetVersion;
		if (!lib.isTargetVersion(version)) {
			throw new Error(`Invalid Factorio version ${version}`);
		}
		const [dataDir] = await findVersion(factorioDir, version);
		scenarioPath = path.join(dataDir, "base", "scenarios", "freeplay");
	}

	const modules = await loadModules(selected);
	logger.info(`Patching ${scenarioPath} with modules ${[...modules.keys()].join(", ")}`);
	await createScenario(scenarioPath, args.output as string, [...modules.values()]);
	logger.info(`Created scenario ${args.output}`);
}
