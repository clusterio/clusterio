// Library for patching Factorio saves with scenario code.

"use strict";
const events = require("events");
const fs = require("fs-extra");
const jszip = require("jszip");
const path = require("path");
const semver = require("semver");

const hash = require("lib/hash");


const knownScenarios = {
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
 * Returns the root folder in the zip file
 *
 * Returns the name of the folder that all files in the zip file is
 * contained in.  Throws an error if there are multiple such folders.
 *
 * @param {module:jszip.JSZip} zip - Zip to search through.
 * @returns {string} name of the root folder.
 * @memberof module:lib/factorio
 * @private
 * @inner
 */
function findRoot(zip) {
	let root = null;
	zip.forEach((relativePath, file) => {
		let index = relativePath.indexOf("/");
		if (index === -1) {
			throw new Error(`Zip contains file '${relativePath}' in root dir`);
		}

		let pathRoot = relativePath.slice(0, index);
		if (root === null) {
			root = pathRoot;
		} else if (root !== pathRoot) {
			throw new Error("Zip contains multiple root folders");
		}
	});

	if (root === null) {
		throw new Error("Empty zip file");
	}

	return root;
}


/**
 * Generates control.lua code for loading the Clusterio modules
 *
 * @param {Object} patchInfo - The patch info files's json content
 * @returns {string} Generated control.lua code.
 * @memberof module:lib/factorio
 * @private
 * @inner
 */
function generateLoader(patchInfo) {
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
		lines.push('event_handler.add_lib(require("'+moduleName+'"))');
	}

	lines.push(...[
		"",
		"-- Clusterio modules",
	]);

	for (let module of patchInfo["modules"]) {
		for (let file of module["files"]) {
			let requirePath = `modules/${module.name}/${file["path"].slice(0, -4)}`;
			if (file["load"]) {
				lines.push('event_handler.add_lib(require("'+requirePath+'"))');
			}
			if (file["require"]) {
				lines.push('require("'+requirePath+'")');
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
 * @param {Array<Object>} modules - Array of modules to reorder
 * @memberof module:lib/factorio
 * @private
 * @inner
 */
function reorderDependencies(modules) {
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
		index++;

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
	for (let modules of hold.values()) {
		for (let module of modules) {
			remaining.set(module.name, module);
		}
	}

	// Start with a random module from the remaining modules
	for (let module of remaining.values()) {
		let cycle = [];
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
 * @param {string} savePath - Path to the Factorio save to patch.
 * @param {Array<Object>} modules - Description of the modules to patch.
 * @memberof module:lib/factorio
 */
async function patch(savePath, modules) {
	let zip = await jszip.loadAsync(await fs.readFile(savePath));
	let root = zip.folder(findRoot(zip));

	let patchInfoFile = root.file("clusterio.json");
	let patchInfo;
	if (patchInfoFile !== null) {
		let content = await patchInfoFile.async("string");
		patchInfo = JSON.parse(content);

	// No info file present, try to detect if it's a known compatible scenario.
	} else {
		let controlStream = root.file("control.lua").nodeStream("nodebuffer");
		let controlHash = await hash.hashStream(controlStream);

		if (controlHash in knownScenarios) {
			patchInfo = {
				"scenario": knownScenarios[controlHash],
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
		let moduleDir = root.folder(`modules/${module.name}`);
		let moduleInfo = {
			"name": module.name,
			"files": [],
		};

		let dirs = [[module.path, ""]];
		while (dirs.length) {
			let [dir, relativeDir] = dirs.pop();
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
	let stream = zip.generateNodeStream({ compression: "DEFLATE" });
	let pipe = stream.pipe(fs.createWriteStream(savePath));
	await events.once(pipe, "finish");
}

module.exports = {
	patch,

	// For testing only
	_findRoot: findRoot,
	_generateLoader: generateLoader,
	_reorderDependencies: reorderDependencies,
};
