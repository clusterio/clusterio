"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const JSZip = require("jszip");
const path = require("path");

const lib = require("@clusterio/lib");
const patch = require("@clusterio/host/dist/src/patch");


describe("host/patch", function() {
	describe("class SaveModule", function() {
		describe("static moduleFilePath()", function() {
			it("Should remap locale files", function() {
				const mappings = [
					["locale/en/foo.cfg", "locale/en/test-foo.cfg"],
					["locale/en/foo.txt", "locale/en/test-foo.txt"],
					["locale/en/foo.txt.tmp", "locale/en/test-foo.txt.tmp"],
					["locale/en/foo", "locale/en/test-foo"],
					["locale/en.cfg", "locale/en/test.cfg"],
					["locale/en.txt", "locale/en/test.txt"],
					["locale/en.txt.tmp", "locale/en/test.txt.tmp"],
					["locale/en", "locale/en/test"],
					["locale/en/bar/foo.cfg", "locale/en/test-bar/foo.cfg"],
				];
				for (let [input, expected] of mappings) {
					assert.equal(patch.SaveModule.moduleFilePath(input, "test"), expected);
				}
			});
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
		let patchInfo = new patch.PatchInfo(
			1,
			new lib.ModuleInfo("foo", "0.0.0", ["foo"]),
			[
				new patch.SaveModule(
					new lib.ModuleInfo(
						"spam",
						"0.0.0",
						["bar.lua"],
						["spam.lua"],
					),
					new Map([
						["bar.lua", Buffer.from("")],
						["spam.lua", Buffer.from("")],
						["excluded.lua", Buffer.from("")],
					]),
				),
			],
		);

		it("should produce output matching the reference", function() {
			assert.equal(patch._generateLoader(patchInfo), reference);
		});
	});

	function module({ name, version, dependencies = {} }) {
		const dependencyMap = new Map(Object.entries(dependencies));
		return new patch.SaveModule(new lib.ModuleInfo(name, version, [], [], dependencyMap));
	}

	describe("reorderDependencies()", function() {
		it("should reorder to satisfy simple dependency", function() {
			let modules = [
				module({ name: "a", version: "1.0.0", dependencies: {"b": "*"} }),
				module({ name: "b", version: "1.0.0", dependencies: {} }),
			];
			patch._reorderDependencies(modules);
			assert(modules[0].info.name === "b", "Dependency was not reorederd");
		});
		it("should throw on invalid version", function() {
			let modules = [
				module({ name: "a", version: "foo", dependencies: {} }),
			];
			assert.throws(
				() => patch._reorderDependencies(modules),
				new Error("Invalid version 'foo' for module a")
			);
		});
		it("should throw on invalid version range", function() {
			let modules = [
				module({ name: "a", version: "1.0.0", dependencies: {"b": "invalid"} }),
			];
			assert.throws(
				() => patch._reorderDependencies(modules),
				new Error("Invalid version range 'invalid' for dependency b on module a")
			);
		});
		it("should throw on missing dependency", function() {
			let modules = [
				module({ name: "a", version: "1.0.0", dependencies: {"b": "*"} }),
			];
			assert.throws(
				() => patch._reorderDependencies(modules),
				new Error("Missing dependency b for module a")
			);
			modules = [
				module({ name: "a", version: "1.0.0", dependencies: {"b": "*"} }),
				module({ name: "b", version: "1.0.0", dependencies: {"c": "*"} }),
				module({ name: "c", version: "1.0.0", dependencies: {"d": "*"} }),
			];
			assert.throws(
				() => patch._reorderDependencies(modules),
				new Error("Missing dependency d for module c")
			);
		});
		it("should throw on outdated dependency", function() {
			let modules = [
				module({ name: "a", version: "1.0.0", dependencies: {} }),
				module({ name: "b", version: "1.0.0", dependencies: {"a": ">=2"} }),
			];
			assert.throws(
				() => patch._reorderDependencies(modules),
				new Error("Module b requires a >=2")
			);
		});
		it("should throw on dependency loops", function() {
			let modules = [
				module({ name: "a", version: "1.0.0", dependencies: {"b": "*"} }),
				module({ name: "b", version: "1.0.0", dependencies: {"a": "*"} }),
			];
			assert.throws(
				() => patch._reorderDependencies(modules),
				new Error("Module dependency loop detected: a -> b -> a")
			);
			modules = [
				module({ name: "d", version: "1.0.0", dependencies: {"b": "*"} }),
				module({ name: "a", version: "1.0.0", dependencies: {"b": "*"} }),
				module({ name: "b", version: "1.0.0", dependencies: {"c": "*"} }),
				module({ name: "c", version: "1.0.0", dependencies: {"a": "*"} }),
			];
			assert.throws(
				() => patch._reorderDependencies(modules),
				new Error("Module dependency loop detected: b -> c -> a -> b")
			);
		});
		it("should reorder correctly for multiple dependencies", function() {
			function validate(modules) {
				let present = new Set();
				for (let { info } of modules) {
					for (let dependency of info.dependencies.keys()) {
						if (!present.has(dependency)) {
							assert.fail(`${info.name} depends on ${dependency}, but was ordered before it`);
						}
					}
					present.add(info.name);
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
					modules.push(module({ name, version: "1.0.0", dependencies }));
				}
				let success = false;
				try {
					patch._reorderDependencies(modules);
					success = true;
				} catch (err) { }
				if (success) {
					validate(modules);
					successCount += 1;
				}
			}

			// Deriving the formula for the number of graphs without
			// dependencies loops is left as an excercise for the reader.
			assert.equal(successCount, 25, "Incorrect number of successful orderings");
		});
	});

	describe("patch()", function() {
		it("should throw on unknown scenario", async function() {
			let zip = new JSZip();
			zip.file("world/control.lua", "-- unknown\n");
			let zipPath = path.join("temp", "test", "patch.zip");
			await fs.outputFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));

			await assert.rejects(
				patch.patch(zipPath, []),
				new Error("Unable to patch save, unknown scenario (3acc3be3861144e55604f5ac2f2555071885ebc4)")
			);
		});
	});
});
