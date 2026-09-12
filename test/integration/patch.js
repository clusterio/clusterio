import assert from "node:assert/strict";
import fs from "node:fs/promises";
import JSZip from "jszip";
import path from "node:path";

import { patch, SaveModule } from "@clusterio/host/dist/node/src/patch.js";
import * as lib from "@clusterio/lib";

import { slowTest } from "./index.js";


// The server integration test is required to run before this one
import "./server.js";

describe("Integration of lib/factorio/patch", function() {
	describe("patch()", function() {
		let savePath = path.join("temp", "test", "integration", "saves", "test.zip");
		it("should patch a freeplay game", async function() {
			slowTest(this);
			let testModule = new SaveModule(new lib.ModuleInfo("test", "1.0.0"));
			let subdirModule = new SaveModule(new lib.ModuleInfo("subdir", "1.0.0"));
			await testModule.loadFiles("test/file/modules/test");
			await subdirModule.loadFiles("test/file/modules/subdir");
			await patch(savePath, [testModule, subdirModule]);

			let zip = await JSZip.loadAsync(await fs.readFile(savePath));
			assert.equal(await zip.file("test/modules/test/test.lua").async("string"), "-- test\n");
			assert.equal(await zip.file("test/modules/subdir/dir/test.lua").async("string"), "-- test\n");
			assert.equal(
				await zip.file("test/locale/en/test.cfg").async("string"),
				"module-test=A Test\n"
			);
			assert.equal(
				await zip.file("test/locale/en/test-locale.cfg").async("string"),
				"module-test-locale=Test Locale\n"
			);
		});
		it("should remove old modules in a save", async function() {
			slowTest(this);
			await patch(savePath, []);
			let zip = await JSZip.loadAsync(await fs.readFile(savePath));
			assert.equal(zip.file("test/modules/test/test.lua"), null);
		});
	});
});
