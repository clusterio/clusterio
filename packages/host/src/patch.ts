// Library for patching Factorio saves with scenario code.

"use strict";
import events from "events";
import fs from "fs-extra";
import JSZip from "jszip";
import path from "path";
import semver from "semver";

import * as lib from "@clusterio/lib";


interface ScenarioInfo {
	name: string;
	modules: string[];
}

export interface ModuleInfo {
	name: string;
	version: string;
	path: string;
	dependencies: Record<string, string>;
	load: string[];
	require: string[];
}

interface PatchInfo {
	patch_number: number;
	scenario: ScenarioInfo;
	modules: { name: string, files: { path: string, load: boolean, require: boolean }[],  }[];
}

const knownScenarios: Record<string, ScenarioInfo> = {
	// First seen in 0.17.63
	"4e866186ebe297f1038fd325b09df1a1f5e2fdd1": {
		"name": "freeplay",
		"modules": [
			"freeplay",
			"silo-script",
		],
	},
};

/**
 * Generates control.lua code for loading the Clusterio modules
 *
 * @param patchInfo - The patch info files's json content
 * @returns Generated control.lua code.
 * @internal
 */
function generateLoader(patchInfo: PatchInfo) {
	let lines = [
		"-- Auto generated scenario module loader created by Clusterio",
		"-- Modifications to this file will be lost when loaded in Clusterio",
		`clusterio_patch_number = ${patchInfo.patch_number}`,
		"",
		'local event_handler = require("event_handler")',
		"",
		"-- Scenario modules",
	];

	for (let moduleName of patchInfo["scenario"]["modules"]) {
		lines.push(`event_handler.add_lib(require("${moduleName}"))`);
	}

	lines.push(...[
		"",
		"-- Clusterio modules",
	]);

	for (let module of patchInfo["modules"]) {
		for (let file of module["files"]) {
			let requirePath = `modules/${module.name}/${file["path"].slice(0, -4)}`;
			if (file["load"]) {
				lines.push(`event_handler.add_lib(require("${requirePath}"))`);
			}
			if (file["require"]) {
				lines.push(`require("${requirePath}")`);
			}
		}
	}

	// End last line with a newline
	lines.push("");

	return lines.join("\n");
}

/**
 * Reorders modules to satisfy their dependencies
 *
 * Looks through and reorders the array of module definitions in order to
 * satisfy the property that dependencies are earlier in the array than
 * their dependents.  Throws an error if this is not possible.
 *
 * @param modules - Array of modules to reorder
 * @internal
 */
function reorderDependencies(modules: ModuleInfo[]) {
	let index = 0;
	let present = new Map();
	let hold = new Map();
	reorder: while (index < modules.length) {
		let module = modules[index];
		if (semver.valid(module.version) === null) {
			throw new Error(`Invalid version '${module.version}' for module ${module.name}`);
		}

		for (let [dependency, requirement] of Object.entries(module.dependencies)) {
			if (semver.validRange(requirement) === null) {
				throw new Error(
					`Invalid version range '${requirement}' for dependency ${dependency} on module ${module.name}`
				);
			}

			if (present.has(dependency)) {
				if (!semver.satisfies(present.get(dependency), requirement)) {
					throw new Error(`Module ${module.name} requires ${dependency} ${requirement}`);
				}

			// We have an unmet dependency, take it out and continue
			} else {
				if (hold.has(dependency)) {
					hold.get(dependency).push(module);
				} else {
					hold.set(dependency, [module]);
				}
				modules.splice(index, 1);
				continue reorder;
			}
		}

		// No unmet dependencies, record and continue
		present.set(module.name, module.version);
		index += 1;

		if (hold.has(module.name)) {
			modules.splice(index, 0, ...hold.get(module.name));
			hold.delete(module.name);
		}
	}

	if (!hold.size) {
		return;
	}

	// There are three reasons for a module to end up being held: The module depends
	// on a module that is missing, the module is part of a dependency loop, or the
	// the module depends on a module that satisfy any of these conditions.

	let remaining = new Map();
	for (let heldModules of hold.values()) {
		for (let module of heldModules) {
			remaining.set(module.name, module);
		}
	}

	// Start with a random module from the remaining modules
	for (let module of remaining.values()) {
		let cycle: string[] = [];
		while (true) {
			// Find an unmet dependency
			let dependency = Object.keys(module.dependencies).find(name => !present.has(name));

			if (!remaining.has(dependency)) {
				// There's no module being held up by this dependency, the
				// dependency is missing.
				throw new Error(`Missing dependency ${dependency} for module ${module.name}`);
			}

			if (cycle.includes(module.name)) {
				cycle.push(module.name);
				cycle.splice(0, cycle.indexOf(module.name));
				throw new Error(`Module dependency loop detected: ${cycle.join(" -> ")}`);
			}

			cycle.push(module.name);
			module = remaining.get(dependency);
		}
	}
}

/**
 * Patch a save with the given modules
 *
 * Adds the modules given by the modules parameter to the save located
 * at savePath and rewrites the control.lua in the save to load the
 * modules that were added.  Will also remove any previous module
 * located in the save.
 *
 * @param savePath - Path to the Factorio save to patch.
 * @param modules - Description of the modules to patch.
 */
export async function patch(savePath: string, modules: ModuleInfo[]) {
	let zip = await JSZip.loadAsync(await fs.readFile(savePath));
	let root = zip.folder(lib.findRoot(zip))!;

	let patchInfoFile = root.file("clusterio.json");
	let patchInfo: PatchInfo;
	if (patchInfoFile !== null) {
		let content = await patchInfoFile.async("string");
		patchInfo = JSON.parse(content);

	// No info file present, try to detect if it's a known compatible scenario.
	} else {
		let controlFile = root.file("control.lua");
		if (!controlFile) {
			throw new Error("Unable to patch save, missing control.lua file.");
		}
		let controlStream = controlFile.nodeStream("nodebuffer");
		let controlHash = await lib.hashStream(controlStream);

		if (controlHash in knownScenarios) {
			patchInfo = {
				"patch_number": 0,
				"scenario": knownScenarios[controlHash],
				"modules": [],
			};
		} else {
			throw new Error(`Unable to patch save, unknown scenario (${controlHash})`);
		}
	}

	// Increment patch number
	patchInfo["patch_number"] = (patchInfo["patch_number"] || 0) + 1;

	// Remove any existing modules from the save
	patchInfo["modules"] = [];
	for (let file of root.file(/^modules\//)) {
		zip.remove(file.name);
	}

	reorderDependencies(modules);

	// Add the modules to the save.
	for (let module of modules) {
		let moduleDir = root.folder(`modules/${module.name}`)!;
		let moduleInfo = {
			"name": module.name,
			"files": [] as { path: string, load: boolean, require: boolean }[],
		};

		let dirs: [string, string][] = [[module.path, ""]];
		while (dirs.length) {
			let [dir, relativeDir] = dirs.pop()!;
			for (let entry of await fs.readdir(dir, { withFileTypes: true })) {
				let fsPath = path.join(dir, entry.name);
				let relativePath = path.posix.join(relativeDir, entry.name);

				if (entry.isFile()) {
					moduleDir.file(relativePath, await fs.readFile(fsPath));
					moduleInfo["files"].push({
						"path": relativePath,
						"load": module.load.includes(relativePath),
						"require": module.require.includes(relativePath),
					});

				} else if (entry.isDirectory()) {
					dirs.push([fsPath, relativePath]);
				}
			}
		}

		patchInfo["modules"].push(moduleInfo);
	}

	// Add loading code and patch info
	root.file("control.lua", generateLoader(patchInfo));
	root.file("clusterio.json", JSON.stringify(patchInfo, null, 4));

	// Write back the save
	let tempSavePath = `${savePath}.tmp`;
	let stream = zip.generateNodeStream({ compression: "DEFLATE" });
	let fd = await fs.open(tempSavePath, "w");
	try {
		let pipe = stream.pipe(fs.createWriteStream("", { fd, autoClose: false }));
		await events.once(pipe, "finish");
		await fs.fsync(fd);
	} finally {
		await fs.close(fd);
	}
	await fs.rename(tempSavePath, savePath);
}

// For testing only
export const _generateLoader = generateLoader;
export const _reorderDependencies = reorderDependencies;
