// Implementation of the create-scenario command
import fs from "node:fs/promises";
import os from "node:os";
import path from "path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

import { loadModules, patch, SaveModule } from "./patch.js";
import { findVersion } from "./server.js";


/**
 * Create a scenario patched with the given modules
 *
 * Runs the save patching on the scenario at scenarioPath and writes the
 * result to outputPath.  The scenario can be a directory, a zipped
 * scenario or a save.
 *
 * @param scenarioPath - Path to the scenario to patch.
 * @param outputPath - Path to write the patched scenario to.
 * @param modules - Description of the modules to patch.
 * @param zip - Write a zip file instead of a directory.
 */
export async function createScenario(
	scenarioPath: string,
	outputPath: string,
	modules: SaveModule[],
	zip = false,
) {
	try {
		await fs.stat(outputPath);
		throw new Error(`${outputPath} already exists`);
	} catch (err: any) {
		if (err.code !== "ENOENT") {
			throw err;
		}
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
		if (zip) {
			await fs.mkdir(path.dirname(outputPath), { recursive: true });
			await fs.copyFile(tempPath, outputPath);
		} else {
			await extractZip(tempPath, outputPath);
		}
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}

async function zipDirectory(dirPath: string, zipPath: string) {
	const root = path.basename(path.resolve(dirPath));
	const zip = new yazl.ZipFile();
	const output = lib.zipOutputStream(zip);
	const fd = await fs.open(zipPath, "w");
	// addFile() can fail before the traversal is done, so start writing first.
	const writing = pipeline(output, fd.createWriteStream());
	writing.catch(() => {});
	try {
		let dirs: [string, string][] = [[dirPath, root]];
		while (dirs.length) {
			let [dir, relativeDir] = dirs.pop()!;
			for (let entry of await fs.readdir(dir, { withFileTypes: true })) {
				let fsPath = path.join(dir, entry.name);
				let relativePath = path.posix.join(relativeDir, entry.name);
				if (entry.isFile()) {
					zip.addFile(fsPath, relativePath);
				} else if (entry.isDirectory()) {
					dirs.push([fsPath, relativePath]);
				}
			}
		}
		zip.end();
	} catch (err) {
		output.destroy();
		await writing.catch(() => {});
		throw err;
	}
	await writing;
}

async function extractZip(zipPath: string, dirPath: string) {
	const zip = await lib.ZipArchive.fromFile(zipPath);
	try {
		const root = lib.findRoot(zip);
		for (let entry of zip.entries.values()) {
			if (entry.fileName.endsWith("/") || !entry.fileName.startsWith(`${root}/`)) {
				continue;
			}
			const fsPath = path.join(dirPath, entry.fileName.slice(root.length + 1));
			await fs.mkdir(path.dirname(fsPath), { recursive: true });
			const fd = await fs.open(fsPath, "w");
			await pipeline(await zip.openStream(entry), fd.createWriteStream());
		}
	} finally {
		zip.close();
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
			describe: "Path to write the scenario to",
			type: "string",
		})
		.option("zip", {
			type: "boolean", nargs: 0, default: false,
			describe: "Write the scenario as a zip file instead of a directory",
		})
		.option("scenario", {
			nargs: 1,
			describe:
				"Path to a scenario directory, zipped scenario or save to patch. " +
				"Defaults to the freeplay scenario of the Factorio install in host.factorio_directory",
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
	await createScenario(scenarioPath, args.output as string, [...modules.values()], Boolean(args.zip));
	logger.info(`Created scenario ${args.output}`);
}
