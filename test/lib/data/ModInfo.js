"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const libSchema = require("@clusterio/lib/schema");
const libHash = require("@clusterio/lib/hash");
const libBuildMod = require("@clusterio/lib/build_mod");
const ModInfo = require("@clusterio/lib/data/ModInfo");


describe("lib/data/ModInfo", function() {
	describe("class ModInfo", function() {
		it("should round trip serialize", function() {
			const validate = libSchema.compile(ModInfo.jsonSchema);
			function check(pack) {
				const json = JSON.parse(JSON.stringify(pack));
				if (!validate(json)) {
					throw validate.errors;
				}
				assert.deepEqual(new ModInfo(json), pack);
			}

			check(new ModInfo());
			check(new ModInfo({ name: "MyMod" }));
			check(new ModInfo({ version: "1.0.0" }));
			check(new ModInfo({ title: "My Extravagent Mod" }));
			check(new ModInfo({ author: "Me" }));
			check(new ModInfo({ contact: "Use my email" }));
			check(new ModInfo({ homepage: "It's over there" }));
			check(new ModInfo({ description: "My Description" }));
			check(new ModInfo({ factorio_version: "2.0" }));
			check(new ModInfo({ dependencies: [] }));
			check(new ModInfo({ dependencies: ["UltraMod", "SuperLib >= 1.00", "! bad-mod"] }));
			check(new ModInfo({ filename: "MyMod_1.0.0.zip" }));
			check(new ModInfo({ size: 1024 }));
			check(new ModInfo({ sha1: "verified-as-MyMod" }));
			check(new ModInfo({ is_deleted: true }));

			// All at once
			check(new ModInfo({
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
			let mods = unsortedVersions.map(v => new ModInfo({ version: v }));
			mods.sort((a, b) => a.integerVersion - b.integerVersion);
			assert.deepEqual(mods.map(mod => mod.version), sortedVersions);
		});
		it("should sort integer factorio versions lexicographically", function() {
			let unsortedVersions = ["1.0", "1.1", "0.1", "3.0", "1.2", "0.3", "2.1"];
			let sortedVersions = ["0.1", "0.3", "1.0", "1.1", "1.2", "2.1", "3.0"];
			let factorioMods = unsortedVersions.map(v => new ModInfo({ factorio_version: v }));
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
			const hash = await libHash.hashFile(filePath);
			const stat = await fs.stat(filePath);
			const mod = await ModInfo.fromModFile(filePath);
			assert.deepEqual(
				mod,
				new ModInfo({
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
