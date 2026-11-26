import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import events from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as libBuildMod from "@clusterio/lib/build_mod.js";


describe("lib/build_mod", function() {
	describe("build() without packing", function() {
		const tempDir = path.join("temp", "test", "build_mod_unpacked");
		const sourceDir = path.join(tempDir, "mod");
		const outputDir = path.join(tempDir, "output");
		beforeEach(async function() {
			await fs.rm(tempDir, { recursive: true, force: true });
			await fs.mkdir(path.join(sourceDir, "module"), { recursive: true });
			await fs.writeFile(path.join(sourceDir, "module", "a.lua"), "-- a");
		});
		after(async function() {
			await fs.rm(tempDir, { recursive: true, force: true });
		});
		async function writeInfo(extra) {
			await fs.writeFile(
				path.join(sourceDir, "info.json"),
				JSON.stringify({ name: "test_mod", version: "1.0.0", ...extra }),
			);
		}

		it("should copy a mod without additional_files", async function() {
			await writeInfo({});
			await libBuildMod.build({ build: true, pack: false, sourceDir, outputDir });
			assert((await fs.readdir(path.join(outputDir, "test_mod_1.0.0"))).includes("info.json"));
		});
		it("should resolve additional_files from the source dir", async function() {
			await writeInfo({ additional_files: { "x.lua": ["module", "a.lua"] } });
			await libBuildMod.build({ build: true, pack: false, sourceDir, outputDir });
			assert.equal(await fs.readFile(path.join(outputDir, "test_mod_1.0.0", "x.lua"), "utf8"), "-- a");
		});
		it("should clean before the output directory exists", async function() {
			await writeInfo({});
			await libBuildMod.build({ clean: true, build: true, pack: false, sourceDir, outputDir });
			assert.deepEqual(await fs.readdir(outputDir), ["test_mod_1.0.0"]);
		});
		it("should reject cleaning when the output path is a file", async function() {
			await writeInfo({});
			await fs.writeFile(outputDir, "");
			await assert.rejects(
				libBuildMod.build({ clean: true, build: true, pack: false, sourceDir, outputDir }),
				{ code: "ENOTDIR" },
			);
		});
		it("should exit with an error code when the build fails", async function() {
			const script = fileURLToPath(import.meta.resolve("@clusterio/lib/build_mod.js"));
			const child = spawn(process.execPath, [script, "--source-dir", path.join(tempDir, "missing")]);
			child.stdout.resume();
			child.stderr.resume();
			const [code] = await events.once(child, "exit");
			assert.equal(code, 1);
		});
	});

	describe("build()", function() {
		const tempDir = path.join("temp", "test", "build_mod");
		const sourceDir = path.join(tempDir, "unreadable_mod");
		const outputDir = path.join(tempDir, "output");
		before(async function() {
			if (process.platform === "win32" || process.getuid?.() === 0) {
				this.skip();
			}
			await fs.rm(tempDir, { recursive: true, force: true });
			await fs.mkdir(sourceDir, { recursive: true });
			await fs.writeFile(
				path.join(sourceDir, "info.json"),
				JSON.stringify({ name: "unreadable_mod", version: "1.0.0" }),
			);
			await fs.writeFile(path.join(sourceDir, "unreadable.lua"), "");
			await fs.chmod(path.join(sourceDir, "unreadable.lua"), 0o000);
			for (let i = 0; i < 20; i++) {
				await fs.mkdir(path.join(sourceDir, `dir${i}`));
				await fs.writeFile(path.join(sourceDir, `dir${i}`, "file.lua"), "");
			}
		});
		after(async function() {
			await fs.rm(tempDir, { recursive: true, force: true });
		});

		it("should reject when a source file is unreadable", async function() {
			await assert.rejects(
				libBuildMod.build({ build: true, pack: true, sourceDir, outputDir }),
				{ code: "EACCES" },
			);
			assert.deepEqual(await fs.readdir(outputDir), []);
		});
	});
});
