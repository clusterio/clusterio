import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import * as libBuildMod from "@clusterio/lib/build_mod.js";


describe("lib/build_mod", function() {
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
