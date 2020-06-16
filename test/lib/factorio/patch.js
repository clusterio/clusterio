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
			"-- Auto generated scenario module loader created by Clusterio",
			"-- Modifications to this file will be lost when loaded in Clusterio",
			"clusterio_patch_number = 1",
			"",
			'local event_handler = require("event_handler")',
			"",
			"-- Scenario modules",
			'event_handler.add_lib(require("foo"))',
			"",
			"-- Clusterio modules",
			'event_handler.add_lib(require("modules/spam/bar"))',
			'require("modules/spam/spam")',
			"",
		].join("\n");
		let patchInfo = {
			"patch_number": 1,
			"scenario": { "modules": ["foo"] },
			"modules": [{
				"name": "spam",
				"files": [
					{ "path": "bar.lua", "load": true, "require": false },
					{ "path": "spam.lua", "load": false, "require": true },
					{ "path": "excluded.lua", "load": false, "require": false },
				],
			}],
		};

		it("should produce output matching the reference", function() {
			assert.equal(factorio._generateLoader(patchInfo), reference);
		});
	});

	describe("reorderDependencies()", function() {
		it("should reorder to satisfy simple dependency", function() {
			let modules = [
				{ name: "a", version: "1.0.0", dependencies: {"b": "*"} },
				{ name: "b", version: "1.0.0", dependencies: {} },
			];
			factorio._reorderDependencies(modules);
			assert(modules[0].name === "b", "Dependency was not reorederd");
		});
		it("should throw on invalid version", function() {
			let modules = [
				{ name: "a", version: "foo", dependencies: {} },
			];
			assert.throws(
				() => factorio._reorderDependencies(modules),
				new Error("Invalid version 'foo' for module a")
			);
		});
		it("should throw on invalid version range", function() {
			let modules = [
				{ name: "a", version: "1.0.0", dependencies: {"b": "invalid"} },
			];
			assert.throws(
				() => factorio._reorderDependencies(modules),
				new Error("Invalid version range 'invalid' for dependency b on module a")
			);
		});
		it("should throw on missing dependency", function() {
			let modules = [
				{ name: "a", version: "1.0.0", dependencies: {"b": "*"} },
			];
			assert.throws(
				() => factorio._reorderDependencies(modules),
				new Error("Missing dependency b for module a")
			);
			modules = [
				{ name: "a", version: "1.0.0", dependencies: {"b": "*"} },
				{ name: "b", version: "1.0.0", dependencies: {"c": "*"} },
				{ name: "c", version: "1.0.0", dependencies: {"d": "*"} },
			];
			assert.throws(
				() => factorio._reorderDependencies(modules),
				new Error("Missing dependency d for module c")
			);
		});
		it("should throw on outdated dependency", function() {
			let modules = [
				{ name: "a", version: "1.0.0", dependencies: {} },
				{ name: "b", version: "1.0.0", dependencies: {"a": ">=2"} },
			];
			assert.throws(
				() => factorio._reorderDependencies(modules),
				new Error("Module b requires a >=2")
			);
		});
		it("should throw on dependency loops", function() {
			let modules = [
				{ name: "a", version: "1.0.0", dependencies: {"b": "*"} },
				{ name: "b", version: "1.0.0", dependencies: {"a": "*"} },
			];
			assert.throws(
				() => factorio._reorderDependencies(modules),
				new Error("Module dependency loop detected: a -> b -> a")
			);
			modules = [
				{ name: "d", version: "1.0.0", dependencies: {"b": "*"} },
				{ name: "a", version: "1.0.0", dependencies: {"b": "*"} },
				{ name: "b", version: "1.0.0", dependencies: {"c": "*"} },
				{ name: "c", version: "1.0.0", dependencies: {"a": "*"} },
			];
			assert.throws(
				() => factorio._reorderDependencies(modules),
				new Error("Module dependency loop detected: b -> c -> a -> b")
			);
		});
		it("should reorder correctly for multiple dependencies", function() {
			function validate(modules) {
				let present = new Set();
				for (let module of modules) {
					for (let dependency of Object.keys(module.dependencies)) {
						if (!present.has(dependency)) {
							assert.fail(`${module.name} depends on ${dependency}, but was ordered before it`);
						}
					}
					present.add(module.name);
				}
			}

			let names = ["a", "b", "c"];
			let successCount = 0;
			const bitCount = names.length * (names.length - 1);
			for (let i=0; i < 2**bitCount; i++) {
				let value = i;
				let bits = [];
				for (let j=0; j < bitCount; j++) {
					bits.push(value & 1);
					value >>= 1;
				}
				let modules = [];
				for (let j=0; j < names.length; j++) {
					let name = names[j];
					let dependencies = {};
					for (let k=0; k < names.length - 1; k++) {
						if (bits[k + j * (names.length - 1)]) {
							dependencies[names[k + (k >= j)]] = "*";
						}
					}
					modules.push({ name, version: "1.0.0", dependencies });
				}
				let success = false;
				try {
					factorio._reorderDependencies(modules);
					success = true;
				} catch (err) { }
				if (success) {
					validate(modules);
					successCount++;
				}
			}

			// Deriving the formula for the number of graphs without
			// dependencies loops is left as an excercise for the reader.
			assert(successCount === 25, "Incorrect number of successful orderings");
		});
	});

	describe("patch()", function() {
		it("should throw on unknown scenario", async function() {
			let zip = new jszip();
			zip.file("world/control.lua", "-- unknown\n");
			let zipPath = path.join("temp", "test", "patch.zip");
			await fs.outputFile(zipPath, await zip.generateAsync({type: "nodebuffer"}))

			await assert.rejects(
				factorio.patch(zipPath, []),
				new Error("Unable to patch save, unknown scenario (3acc3be3861144e55604f5ac2f2555071885ebc4)")
			);
		});
	});
});
