/**
 * Library for patching Factorio saves with scenario code.
 * @author Hornwitser
 */

"use strict";
const events = require("events");
const fs = require("fs-extra");
const jszip = require("jszip");
const path = require("path");

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
 * @returns {string} name of the root folder.
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
			throw new Error(`Zip contains multiple root folders`);
		}
	});

	if (root === null) {
		throw new Error(`Empty zip file`);
	}

	return root;
}


/**
 * Generates control.lua code for loading the Clusterio modules
 *
 * @param {Object} patchInfo - The patch info files's json content
 */
function generateLoader(patchInfo) {
	let lines = [
		'-- Auto generated scenario module loader created by Clusterio',
		'-- Modifications to this file will be lost when loaded in Clusterio',
		'',
		'local event_handler = require("event_handler")',
		'',
		'-- Scenario modules',
	];

	for (let moduleName of patchInfo["scenario"]["modules"]) {
		lines.push('event_handler.add_lib(require("'+moduleName+'"))');
	}

	lines.push(...[
		'',
		'-- Clusterio modules',
	]);

	for (let module of patchInfo["modules"]) {
		for (let file of module["files"]) {
			if (file["load"]) {
				let requirePath = `modules/${module.name}/${file["path"].slice(0, -4)}`;
				lines.push('event_handler.add_lib(require("'+requirePath+'"))');
			}
		}
	}

	// End last line with a newline
	lines.push('');

	return lines.join('\n');
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

	// Remove any existing modules from the save
	patchInfo["modules"] = [];
	for (let file of root.file(/^modules\//)) {
		zip.remove(file.name);
	}

	// Add the modules to the save.
	for (let module of modules) {
		let moduleDir = root.folder(`modules/${module.name}`);
		let moduleInfo = {
			"name": module.name,
			"files": [],
		}

		let dirs = [[module.path, '']];
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
	let stream = zip.generateNodeStream({compression: "DEFLATE"});
	let pipe = stream.pipe(fs.createWriteStream(savePath));
	await events.once(pipe, "finish");
}

module.exports = {
	patch,

	// For testing only
	_findRoot: findRoot,
	_generateLoader: generateLoader,
}
