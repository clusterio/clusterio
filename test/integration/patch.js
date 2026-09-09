"use strict";
const assert = require("assert").strict;
const path = require("path");

const { patch, SaveModule } = require("@clusterio/host/dist/node/src/patch");
const lib = require("@clusterio/lib");

const { slowTest } = require("./index");


// The server integration test is required to run before this one
require("./server");

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

			let zip = await lib.ZipArchive.fromFile(savePath);
			try {
				assert.equal((await zip.readFile("test/modules/test/test.lua")).toString(), "-- test\n");
				assert.equal((await zip.readFile("test/modules/subdir/dir/test.lua")).toString(), "-- test\n");
				assert.equal(
					(await zip.readFile("test/locale/en/test.cfg")).toString(),
					"module-test=A Test\n"
				);
				assert.equal(
					(await zip.readFile("test/locale/en/test-locale.cfg")).toString(),
					"module-test-locale=Test Locale\n"
				);
			} finally {
				zip.close();
			}
		});
		it("should remove old modules in a save", async function() {
			slowTest(this);
			await patch(savePath, []);
			let zip = await lib.ZipArchive.fromFile(savePath);
			try {
				assert.equal(zip.file("test/modules/test/test.lua"), null);
			} finally {
				zip.close();
			}
		});
	});
});
