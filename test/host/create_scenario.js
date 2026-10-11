import assert from "node:assert/strict";
import fs from "node:fs/promises";
import JSZip from "jszip";
import path from "node:path";

import * as lib from "@clusterio/lib";
import {
	createScenario, createScenarioCommand, handleCreateScenarioCommand,
} from "@clusterio/host/dist/node/src/create_scenario.js";
import { SaveModule, PatchInfo } from "@clusterio/host/dist/node/src/patch.js";


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

	it("should write a zip file when asked to", async function() {
		const output = path.join(tempDir, "zipped.zip");
		await createScenario(path.join(tempDir, "scenario"), output, [module], true);
		const zip = await JSZip.loadAsync(await fs.readFile(output));
		const files = new Map();
		for (const file of Object.values(zip.files)) {
			if (!file.dir) {
				files.set(file.name.replace(/^scenario\//, ""), await file.async("string"));
			}
		}
		checkOutput(files);
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

	describe("createScenarioCommand()", function() {
		it("should define the output positional and options", function() {
			const positionals = [];
			const options = [];
			const yargs = {
				positional(name) { positionals.push(name); return yargs; },
				option(name) { options.push(name); return yargs; },
			};
			createScenarioCommand(yargs);
			assert.deepEqual(positionals, ["output"]);
			assert.deepEqual(options, ["zip", "scenario", "factorio-version", "plugins"]);
		});
	});

	describe("handleCreateScenarioCommand()", function() {
		const factorioDir = path.join(tempDir, "factorio");
		const scenario = path.join(tempDir, "scenario");
		let hostConfig;
		let pluginInfos;
		before(async function() {
			// Fake install with the test scenario as freeplay
			await fs.cp(path.join("test", "file", "factorio", "0.1.2"), factorioDir, { recursive: true });
			const freeplay = path.join(factorioDir, "data", "base", "scenarios", "freeplay");
			await fs.cp(scenario, freeplay, { recursive: true });
			pluginInfos = await lib.loadPluginInfos(new Map([
				["research_sync", path.resolve("plugins/research_sync")],
				["test_plugin", path.resolve("test/file/test_plugin")],
			]));
			lib.addPluginConfigFields(pluginInfos);
			hostConfig = new lib.HostConfig("host", { "host.factorio_directory": factorioDir });
		});

		it("should patch freeplay with the enabled plugins by default", async function() {
			const output = path.join(tempDir, "default");
			await handleCreateScenarioCommand({ output, factorioVersion: "latest" }, hostConfig, pluginInfos);
			const files = await readDir(output);
			assert.equal(files.get("scenario.lua"), scenarioFiles.get("scenario.lua"));
			const info = JSON.parse(files.get("clusterio.json"));
			assert.deepEqual(info.modules.map(m => m.name), ["clusterio", "research_sync"]);
		});

		it("should skip plugins disabled in the host config", async function() {
			const output = path.join(tempDir, "disabled");
			hostConfig.set("research_sync.load_plugin", false);
			try {
				await handleCreateScenarioCommand({ output, factorioVersion: "latest" }, hostConfig, pluginInfos);
			} finally {
				hostConfig.set("research_sync.load_plugin", true);
			}
			const info = JSON.parse((await readDir(output)).get("clusterio.json"));
			assert.deepEqual(info.modules.map(m => m.name), ["clusterio"]);
		});

		it("should use the given scenario and plugins", async function() {
			const output = path.join(tempDir, "selected");
			await handleCreateScenarioCommand(
				{ output, scenario, plugins: ["research_sync"] }, hostConfig, pluginInfos
			);
			const info = JSON.parse((await readDir(output)).get("clusterio.json"));
			assert.deepEqual(info.modules.map(m => m.name), ["clusterio", "research_sync"]);
		});

		it("should throw on unknown plugin", async function() {
			await assert.rejects(
				handleCreateScenarioCommand(
					{ output: path.join(tempDir, "unknown_plugin"), scenario, plugins: ["nope"] },
					hostConfig,
					pluginInfos,
				),
				new Error("Plugin nope is not in the plugin list")
			);
		});

		it("should throw on invalid Factorio version", async function() {
			await assert.rejects(
				handleCreateScenarioCommand(
					{ output: path.join(tempDir, "bad_version"), factorioVersion: "1..2" }, hostConfig, pluginInfos
				),
				new Error("Invalid Factorio version 1..2")
			);
		});
	});
});
