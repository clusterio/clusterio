"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const jszip = require("jszip");
const path = require("path");

const factorio = require("@clusterio/lib/factorio");

const { slowTest } = require("./index");


// The server integration test is required to run before this one
require("./server");

describe("Integration of lib/factorio/patch", function() {
	describe("patch()", function() {
		let savePath = path.join("temp", "test", "integration", "saves", "test.zip");
		it("should patch a freeplay game", async function() {
			slowTest(this);
			await factorio.patch(savePath, [{
				name: "test",
				version: "1.0.0",
				dependencies: {},
				path: "test/file/modules/test",
				load: [],
				require: [],
			}, {
				name: "subdir",
				version: "1.0.0",
				dependencies: {},
				path: "test/file/modules/subdir",
				load: [],
				require: [],
			}]);

			let zip = await jszip.loadAsync(await fs.readFile(savePath));
			assert.equal(await zip.file("test/modules/test/test.lua").async("string"), "-- test\n");
			assert.equal(await zip.file("test/modules/subdir/dir/test.lua").async("string"), "-- test\n");
		});
		it("should remove old modules in a save", async function() {
			slowTest(this);
			await factorio.patch(savePath, []);
			let zip = await jszip.loadAsync(await fs.readFile(savePath));
			assert.equal(zip.file("test/modules/test/test.lua"), null);
		});
	});
});
