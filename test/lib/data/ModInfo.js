"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const lib = require("@clusterio/lib");
const libBuildMod = require("@clusterio/lib/build_mod");
const { ModInfo } = lib;


describe("lib/data/ModInfo", function() {
	describe("class ModInfo", function() {
		it("should round trip serialize", function() {
			const validate = lib.compile(ModInfo.jsonSchema);
			function check(pack) {
				const json = JSON.parse(JSON.stringify(pack));
				if (!validate(json)) {
					throw validate.errors;
				}
				assert.deepEqual(ModInfo.fromJSON(json), pack);
			}

			check(ModInfo.fromJSON({}));
			check(ModInfo.fromJSON({ name: "MyMod" }));
			check(ModInfo.fromJSON({ version: "1.0.0" }));
			check(ModInfo.fromJSON({ title: "My Extravagent Mod" }));
			check(ModInfo.fromJSON({ author: "Me" }));
			check(ModInfo.fromJSON({ contact: "Use my email" }));
			check(ModInfo.fromJSON({ homepage: "It's over there" }));
			check(ModInfo.fromJSON({ description: "My Description" }));
			check(ModInfo.fromJSON({ factorio_version: "2.0" }));
			check(ModInfo.fromJSON({ dependencies: [] }));
			check(ModInfo.fromJSON({ dependencies: ["UltraMod", "SuperLib >= 1.00", "! bad-mod"] }));
			check(ModInfo.fromJSON({ filename: "MyMod_1.0.0.zip" }));
			check(ModInfo.fromJSON({ size: 1024 }));
			check(ModInfo.fromJSON({ sha1: "verified-as-MyMod" }));
			check(ModInfo.fromJSON({ is_deleted: true }));

			// All at once
			check(ModInfo.fromJSON({
				name: "MyMod",
				version: "1.0.0",
				title: "My Extravagent Mod",
				author: "Me",
				contact: "Use my email",
				homepage: "It's over there",
				description: "My Description",
				factorio_version: "2.0",
				dependencies: ["UltraMod", "SuperLib >= 1.00", "! bad-mod"],
				filename: "MyMod_1.0.0.zip",
				size: 1024,
				sha1: "verified-as-MyMod",
				is_deleted: true,
			}));
		});

		it("should sort integer mod versions lexicographically", function() {
			let unsortedVersions = ["1.0.0", "1.1.0", "0.1.0", "3.0.0", "1.2.0", "0.3.1", "0.3.3", "2.1.1", "0.0.1"];
			let sortedVersions = ["0.0.1", "0.1.0", "0.3.1", "0.3.3", "1.0.0", "1.1.0", "1.2.0", "2.1.1", "3.0.0"];
			let mods = unsortedVersions.map(v => ModInfo.fromJSON({ version: v }));
			mods.sort((a, b) => a.integerVersion - b.integerVersion);
			assert.deepEqual(mods.map(mod => mod.version), sortedVersions);
		});
		it("should sort integer factorio versions lexicographically", function() {
			let unsortedVersions = ["1.0", "1.1", "0.1", "3.0", "1.2", "0.3", "2.1"];
			let sortedVersions = ["0.1", "0.3", "1.0", "1.1", "1.2", "2.1", "3.0"];
			let factorioMods = unsortedVersions.map(v => ModInfo.fromJSON({ factorio_version: v }));
			factorioMods.sort((a, b) => a.integerFactorioVersion - b.integerFactorioVersion);
			assert.deepEqual(factorioMods.map(mod => mod.factorioVersion), sortedVersions);
		});

		it("should load from a mod zip file", async function() {
			await libBuildMod.build({
				build: true,
				pack: true,
				sourceDir: path.join("test", "file", "empty_mod"),
				outputDir: path.join("temp", "test"),
			});
			const filePath = path.join("temp", "test", "empty_mod_1.0.0.zip");
			const hash = await lib.hashFile(filePath);
			const stat = await fs.stat(filePath);
			const mod = await ModInfo.fromModFile(filePath);
			assert.deepEqual(
				mod,
				ModInfo.fromJSON({
					name: "empty_mod",
					version: "1.0.0",
					title: "An Empty Mod",
					author: "Me",
					description: "An empty mod for testing",
					factorio_version: "1.1",
					dependencies: [],
					filename: "empty_mod_1.0.0.zip",
					size: stat.size,
					sha1: hash,
				})
			);
		});
	});
});
