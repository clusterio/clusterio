"use strict";
const assert = require("assert").strict;
const fs = require("node:fs/promises");
const JSZip = require("jszip");
const path = require("path");

const lib = require("@clusterio/lib");
const { createScenario } = require("@clusterio/host/dist/node/src/create_scenario");
const { SaveModule, PatchInfo } = require("@clusterio/host/dist/node/src/patch");


describe("host/create_scenario", function() {
	const tempDir = path.join("temp", "test", "create_scenario");
	const patchInfo = new PatchInfo(0, new lib.ModuleInfo("test", "1.0.0", [], ["scenario"]), []);
	const scenarioFiles = new Map([
		["scenario.lua", "-- scenario\n"],
		["description.json", "{}\n"],
		["locale/en/test.cfg", "test=Test\n"],
		["clusterio.json", JSON.stringify(patchInfo)],
	]);
	const module = new SaveModule(
		new lib.ModuleInfo("spam", "1.0.0", ["spam.lua"]),
		new Map([["modules/spam/spam.lua", Buffer.from("return {}\n")]]),
	);

	async function readDir(dirPath) {
		const files = new Map();
		for (const entry of await fs.readdir(dirPath, { recursive: true, withFileTypes: true })) {
			if (entry.isFile()) {
				const fsPath = path.join(entry.parentPath, entry.name);
				files.set(path.relative(dirPath, fsPath).split(path.sep).join("/"), await fs.readFile(fsPath, "utf8"));
			}
		}
		return files;
	}

	function checkOutput(files) {
		assert(files.get("control.lua").includes('event_handler.add_lib(require("modules/spam/spam"))'));
		assert.equal(JSON.parse(files.get("clusterio.json")).patch_number, 1);
		assert.equal(files.get("modules/spam/spam.lua"), "return {}\n");
		for (const name of ["scenario.lua", "description.json", "locale/en/test.cfg"]) {
			assert.equal(files.get(name), scenarioFiles.get(name));
		}
		assert.equal(files.size, scenarioFiles.size + 2);
	}

	before(async function() {
		await fs.rm(tempDir, { recursive: true, force: true });
		await fs.mkdir(path.join(tempDir, "scenario"), { recursive: true });
		const zip = new JSZip();
		for (const [name, content] of scenarioFiles) {
			const fsPath = path.join(tempDir, "scenario", name);
			await fs.mkdir(path.dirname(fsPath), { recursive: true });
			await fs.writeFile(fsPath, content);
			zip.file(`scenario/${name}`, content);
		}
		await fs.writeFile(path.join(tempDir, "scenario.zip"), await zip.generateAsync({ type: "nodebuffer" }));
	});

	it("should patch a scenario directory", async function() {
		const output = path.join(tempDir, "from_dir");
		await createScenario(path.join(tempDir, "scenario"), output, [module]);
		checkOutput(await readDir(output));
	});

	it("should patch a zipped scenario", async function() {
		const output = path.join(tempDir, "from_zip");
		await createScenario(path.join(tempDir, "scenario.zip"), output, [module]);
		checkOutput(await readDir(output));
	});

	it("should not modify the input scenario", async function() {
		const files = await readDir(path.join(tempDir, "scenario"));
		assert.deepEqual(files, scenarioFiles);
	});

	it("should throw if the output already exists", async function() {
		const output = path.join(tempDir, "from_dir");
		await assert.rejects(
			createScenario(path.join(tempDir, "scenario"), output, [module]),
			new Error(`${output} already exists`),
		);
	});

	it("should throw on unknown scenario", async function() {
		await fs.mkdir(path.join(tempDir, "unknown"));
		await fs.writeFile(path.join(tempDir, "unknown", "control.lua"), "-- unknown\n");
		await assert.rejects(
			createScenario(path.join(tempDir, "unknown"), path.join(tempDir, "from_unknown"), [module]),
			new Error("Unable to patch save, unknown scenario (3acc3be3861144e55604f5ac2f2555071885ebc4)")
		);
	});
});
