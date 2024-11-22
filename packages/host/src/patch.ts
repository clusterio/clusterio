// Library for patching Factorio saves with scenario code.

import events from "events";
import fs from "fs-extra";
import JSZip from "jszip";
import path from "path";
import semver from "semver";
import { Type, Static } from "@sinclair/typebox";

import * as lib from "@clusterio/lib";

import BaseInstancePlugin from "./BaseInstancePlugin";


/**
 * Describes a module that can be patched into a save
 */
export class SaveModule {
	constructor(
		/** Module */
		public info: lib.ModuleInfo,
		/** Files and their content that will be patched into the save */
		public files = new Map<string, Buffer>(),
	) { }

	static moduleFilePath(filePath: string, moduleName: string) {
		// Map locale files to the save's locale folder
		if (filePath.startsWith("locale/")) {
			const slashes = filePath.match(/\//g)!.length;
			if (slashes > 1) {
				const secondSlash = filePath.indexOf("/", "locale/".length);
				return `${filePath.slice(0, secondSlash)}/${moduleName}-${filePath.slice(secondSlash + 1)}`;
			}
			const period = `${filePath}.`.indexOf(".");
			return `${filePath.slice(0, period)}/${moduleName}${filePath.slice(period)}`;
		}
		// Map all other files into modules/name in the save.
		return path.posix.join("modules", moduleName, filePath);
	}

	async loadFiles(moduleDirectory: string) {
		let dirs: [string, string][] = [[moduleDirectory, ""]];
		while (dirs.length) {
			let [dir, relativeDir] = dirs.pop()!;
			for (let entry of await fs.readdir(dir, { withFileTypes: true })) {
				let fsPath = path.join(dir, entry.name);
				let relativePath = path.posix.join(relativeDir, entry.name);

				if (entry.isFile()) {
					let savePath = SaveModule.moduleFilePath(relativePath, this.info.name);
					this.files.set(savePath, await fs.readFile(fsPath));
					if (relativePath === "module_exports.lua") {
						this.files.set(
							`modules/${this.info.name}.lua`,
							Buffer.from(`return require("modules/${this.info.name}/module_exports")`, "utf-8")
						);
					}

				} else if (entry.isDirectory()) {
					dirs.push([fsPath, relativePath]);
				}
			}
		}
	}

	static jsonSchema = Type.Object({
		...lib.ModuleInfo.jsonSchema.properties,
		"files": Type.Array(Type.String()),
	});

	toJSON() {
		return {
			...this.info.toJSON(),
			files: [...this.files.keys()],
		};
	}

	static async fromSave(json: Static<typeof SaveModule.jsonSchema>, root: JSZip) {
		const module = new this(lib.ModuleInfo.fromJSON(json));
		module.files = new Map(await Promise.all(json.files
			.map(filename => ({filename, file: root.file(filename)}))
			.filter(({filename, file}) => {
				if (file === null) {
					lib.logger.warn(`Missing file ${filename} in save`);
				}
				return file !== null;
			})
			.map(async ({filename, file}) => [filename, await file!.async("nodebuffer")] as const)
		));
		return module;
	}

	static async fromPlugin(plugin: BaseInstancePlugin) {
		let pluginPackagePath = require.resolve(path.posix.join(plugin.info.requirePath, "package.json"));
		let moduleDirectory = path.join(path.dirname(pluginPackagePath), "module");
		if (!await fs.pathExists(moduleDirectory)) {
			return null;
		}

		let moduleJsonPath = path.join(moduleDirectory, "module.json");
		let moduleJson;
		try {
			moduleJson = {
				name: plugin.info.name,
				version: plugin.info.version,
				dependencies: { "clusterio": "*" },
				...JSON.parse(await fs.readFile(moduleJsonPath, "utf8")),
			};
		} catch (err: any) {
			throw new Error(`Loading module/module.json in plugin ${plugin.info.name} failed: ${err.message}`);
		}
		if (!lib.ModuleInfo.validate(moduleJson)) {
			throw new Error(
				`module/module.json in plugin ${plugin.info.name} failed validation:\n` +
				`${JSON.stringify(lib.ModuleInfo.validate.errors, null, "\t")}`
			);
		}

		let module = new SaveModule(lib.ModuleInfo.fromJSON(moduleJson));
		await module.loadFiles(moduleDirectory);
		return module;
	}

	static async fromDirectory(moduleDirectory: string) {
		let name = path.basename(moduleDirectory);
		let moduleJsonPath = path.join(moduleDirectory, "module.json");
		let moduleJson;
		try {
			moduleJson = JSON.parse(await fs.readFile(moduleJsonPath, "utf8"));
		} catch (err: any) {
			throw new Error(`Loading ${name}/module.json failed: ${err.message}`);
		}
		if (!lib.ModuleInfo.validate(moduleJson)) {
			throw new Error(
				`${name}/module.json failed validation:\n` +
				`${JSON.stringify(lib.ModuleInfo.validate.errors, null, "\t")}`
			);
		}

		if (moduleJson.name !== name) {
			throw new Error(`Expected name of module ${moduleJson.name} to match the directory name ${name}`);
		}

		let module = new SaveModule(lib.ModuleInfo.fromJSON(moduleJson));
		await module.loadFiles(moduleDirectory);
		return module;
	}
}

export class PatchInfo {
	static currentVersion = 1;

	constructor(
		public patchNumber: number,
		public scenario: lib.ModuleInfo,
		public modules: SaveModule[],
		public version = PatchInfo.currentVersion,
	) { }

	static jsonSchema = Type.Object({
		"version": Type.Number(),
		"patch_number": Type.Number(),
		"scenario": lib.ModuleInfo.jsonSchema,
		"modules": Type.Array(SaveModule.jsonSchema),
	});

	toJSON() {
		return {
			version: PatchInfo.currentVersion,
			patch_number: this.patchNumber,
			scenario: this.scenario.toJSON(),
			modules: this.modules.map(m => m.toJSON()),
		};
	}

	static async fromSave(json: Static<typeof PatchInfo.jsonSchema>, root: JSZip) {
		if (json.version === undefined) {
			interface ScenarioInfoV0 {
				name: string;
				modules: string[];
			}
			interface PatchInfoV0 {
				patch_number: number;
				scenario: ScenarioInfoV0;
				modules: { name: string, files: { path: string, load: boolean, require: boolean }[], }[];
			}

			const info = json as unknown as PatchInfoV0;
			return new this(
				info.patch_number,
				new lib.ModuleInfo(info.scenario.name, "0.0.0", info.scenario.modules),
				[],
				0,
			);
		}

		return new this(
			json.patch_number,
			lib.ModuleInfo.fromJSON(json.scenario),
			await Promise.all(json.modules.map(m => SaveModule.fromSave(m, root))),
		);
	}
}

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
		`clusterio_patch_number = ${patchInfo.patchNumber}`,
		"",
		'local event_handler = require("event_handler")',
		"",
		"-- Scenario modules",
	];

	for (let requirePath of patchInfo.scenario.load) {
		lines.push(`event_handler.add_lib(require("${requirePath}"))`);
	}
	for (let requirePath of patchInfo.scenario.require) {
		lines.push(`require("${requirePath}")`);
	}

	lines.push(...[
		"",
		"-- Clusterio modules",
	]);

	for (let module of patchInfo.modules) {
		for (let file of module.info.load) {
			let requirePath = `modules/${module.info.name}/${file.replace(/\.lua$/i, "")}`;
			lines.push(`event_handler.add_lib(require("${requirePath}"))`);
		}
		for (let file of module.info.require) {
			let requirePath = `modules/${module.info.name}/${file.replace(/\.lua$/i, "")}`;
			lines.push(`require("${requirePath}")`);
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
function reorderDependencies(modules: SaveModule[]) {
	let index = 0;
	let present = new Map<string, string>();
	let hold = new Map<string, [SaveModule]>();
	reorder: while (index < modules.length) {
		let module = modules[index];
		if (semver.valid(module.info.version) === null) {
			throw new Error(`Invalid version '${module.info.version}' for module ${module.info.name}`);
		}

		for (let [dependency, requirement] of module.info.dependencies) {
			if (semver.validRange(requirement) === null) {
				throw new Error(
					`Invalid version range '${requirement}' for dependency ${dependency} on module ${module.info.name}`
				);
			}

			if (present.has(dependency)) {
				if (!semver.satisfies(present.get(dependency)!, requirement)) {
					throw new Error(`Module ${module.info.name} requires ${dependency} ${requirement}`);
				}

			// We have an unmet dependency, take it out and continue
			} else {
				if (hold.has(dependency)) {
					hold.get(dependency)!.push(module);
				} else {
					hold.set(dependency, [module]);
				}
				modules.splice(index, 1);
				continue reorder;
			}
		}

		// No unmet dependencies, record and continue
		present.set(module.info.name, module.info.version);
		index += 1;

		if (hold.has(module.info.name)) {
			modules.splice(index, 0, ...hold.get(module.info.name)!);
			hold.delete(module.info.name);
		}
	}

	if (!hold.size) {
		return;
	}

	// There are three reasons for a module to end up being held: The module depends
	// on a module that is missing, the module is part of a dependency loop, or the
	// the module depends on a module that satisfy any of these conditions.

	let remaining = new Map<string, SaveModule>();
	for (let heldModules of hold.values()) {
		for (let module of heldModules) {
			remaining.set(module.info.name, module);
		}
	}

	// Start with a random module from the remaining modules
	for (let module of remaining.values()) {
		let cycle: string[] = [];
		while (true) {
			// Find an unmet dependency
			let dependency = [...module.info.dependencies.keys()].find(name => !present.has(name))!;

			if (!remaining.has(dependency)) {
				// There's no module being held up by this dependency, the
				// dependency is missing.
				throw new Error(`Missing dependency ${dependency} for module ${module.info.name}`);
			}

			if (cycle.includes(module.info.name)) {
				cycle.push(module.info.name);
				cycle.splice(0, cycle.indexOf(module.info.name));
				throw new Error(`Module dependency loop detected: ${cycle.join(" -> ")}`);
			}

			cycle.push(module.info.name);
			module = remaining.get(dependency)!;
		}
	}
}

const knownScenarios: Record<string, lib.ModuleInfo> = {
	// First seen in 0.17.63
	"4e866186ebe297f1038fd325b09df1a1f5e2fdd1": new lib.ModuleInfo("freeplay", "0.17.63", [], ["scenario"]),
	// First seen in 2.0 TODO Uncomment once clusterio lib supports 2.0
	// The rest of the code has already been updated to support the new control.lua file for 2.0
	// "bcbdde18ce4ec16ebfd93bd694cd9b12ef969c9a": new lib.ModuleInfo("freeplay", "2.0.0", [], ["scenario"]),
};

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
export async function patch(savePath: string, modules: SaveModule[]) {
	let zip = await JSZip.loadAsync(await fs.readFile(savePath));
	let root = zip.folder(lib.findRoot(zip))!;

	let patchInfoFile = root.file("clusterio.json");
	let patchInfo: PatchInfo;
	if (patchInfoFile !== null) {
		let content = await patchInfoFile.async("string");
		patchInfo = await PatchInfo.fromSave(JSON.parse(content), root);
		if (patchInfo.version > PatchInfo.currentVersion) {
			throw new Error(
				`Save patch version ${patchInfo.version} is newer than the patch version this ` +
				`version of Clusterio can load (${PatchInfo.currentVersion})`
			);
		}

	// No info file present, try to detect if it's a known compatible scenario.
	} else {
		let controlFile = root.file("control.lua");
		if (!controlFile) {
			throw new Error("Unable to patch save, missing control.lua file.");
		}
		let controlStream = controlFile.nodeStream("nodebuffer");
		let controlHash = await lib.hashStream(controlStream);

		if (controlHash in knownScenarios) {
			patchInfo = new PatchInfo(0, knownScenarios[controlHash], []);
			root.file("scenario.lua", controlFile.nodeStream("nodebuffer"));
		} else {
			throw new Error(`Unable to patch save, unknown scenario (${controlHash})`);
		}
	}

	// Increment patch number
	patchInfo.patchNumber = patchInfo.patchNumber + 1;

	// Remove any existing modules from the save
	if (patchInfo.version === 0) {
		for (let file of root.file(/^modules\//)) {
			zip.remove(file.name);
		}
	} else {
		for (let module of patchInfo.modules) {
			for (let filepath of module.files.keys()) {
				const file = root.file(filepath);
				if (file !== null) {
					zip.remove(file.name);
				}
			}
		}
		patchInfo.modules = [];
	}

	reorderDependencies(modules);

	// Add the modules to the save.
	for (let module of modules) {
		for (let [relativePath, contents] of module.files) {
			root.file(relativePath, contents);
		}
		patchInfo.modules.push(module);
	}

	// Add loading code and patch info
	root.file("control.lua", generateLoader(patchInfo));
	root.file("clusterio.json", JSON.stringify(patchInfo, null, "\t"));

	// Write back the save
	let tempSavePath = savePath.replace(/(\.zip)?$/, ".tmp.zip");
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
