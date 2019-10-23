const assert = require("assert").strict;
const fs = require("fs-extra");
const jszip = require("jszip");
const path = require("path");

const factorio = require("lib/factorio");


describe("lib/factorio", function() {
	describe("findRoot()", function() {
		it("should find the root of a zip", function() {
			let zip = new jszip();
			zip.file("root/foo.txt", "");
			zip.file("root/bar.txt", "");

			assert.equal(factorio._findRoot(zip), "root");
		});

		it("should throw if files are at the root of the zip", function() {
			let zip = new jszip();
			zip.file("root/foo.txt", "");
			zip.file("bar.txt", "");

			assert.throws(
				() => factorio._findRoot(zip),
				new Error("Zip contains file 'bar.txt' in root dir")
			);
		});

		it("should throw if there are multiple root dirs", function() {
			let zip = new jszip();
			zip.file("root-1/foo.txt", "");
			zip.file("root-2/bar.txt", "");

			assert.throws(
				() => factorio._findRoot(zip),
				new Error("Zip contains multiple root folders")
			);
		});

		it("should throw if given an empty zip file", function() {
			let zip = new jszip();

			assert.throws(
				() => factorio._findRoot(zip),
				new Error("Empty zip file")
			);
		});
	});

	describe("generateLoader()", function() {
		let reference = [
			'-- Auto generated scenario module loader created by Clusterio',
			'-- Modifications to this file will be lost when loaded in Clusterio',
			'',
			'local event_handler = require("event_handler")',
			'',
			'-- Scenario modules',
			'event_handler.add_lib(require("foo"))',
			'',
			'-- Clusterio modules',
			'event_handler.add_lib(require("modules/bar"))',
			'',
		].join('\n');
		let patchInfo = {
			"scenario": { "modules": ["foo"] },
			"modules": [{
				"name": "spam",
				"files": [
					{ "path": "bar.lua", "load": true },
					{ "path": "excluded.lua", "load": false },
				],
			}],
		};

		it("should produce output matching the reference", function() {
			assert.equal(factorio._generateLoader(patchInfo), reference);
		});
	});

	describe("patch()", function() {
		it("should throw on unknown scenario", async function() {
			let zip = new jszip();
			zip.file("world/control.lua", "-- unknown\n");
			let zipPath = path.join("test", "temp", "patch.zip");
			await fs.outputFile(zipPath, await zip.generateAsync({type: "nodebuffer"}))

			await assert.rejects(
				factorio.patch(zipPath, []),
				new Error("Unable to patch save, unknown scenario (3acc3be3861144e55604f5ac2f2555071885ebc4)")
			);
		});
	});
});
