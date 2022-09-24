"use strict";
const assert = require("assert").strict;
const zlib = require("zlib");

const libSchema = require("@clusterio/lib/schema");
const ModPack = require("@clusterio/lib/data/ModPack");


describe("lib/data/ModPack", function() {
	describe("class ModPack", function() {
		it("should round trip serialize", function() {
			const validate = libSchema.compile(ModPack.jsonSchema);
			function check(pack) {
				const json = JSON.parse(JSON.stringify(pack));
				if (!validate(json)) {
					throw validate.errors;
				}
				assert.deepEqual(new ModPack(json), pack);
				const packStringed = ModPack.fromModPackString(pack.toModPackString(true));
				packStringed.id = pack.id;
				assert.deepEqual(packStringed, pack);
			}

			check(new ModPack());
			check(new ModPack({ name: "MyPack" }));
			check(new ModPack({ description: "My Description" }));
			check(new ModPack({ factorio_version: "2.0" }));
			check(new ModPack({ mods: [
				{ name: "subspace_storage", version: "1.99.8" },
				{ name: "clusterio_lib", version: "0.1.2", sha1: "012345abcd" },
			]}));
			check(new ModPack({ settings: {
				"startup": {
					"bool-setting": { "value": true },
				},
				"runtime-global": {
					"number-setting": { "value": 123 },
				},
				"runtime-per-user": {
					"string-setting": { "value": "a string" },
				},
			}}));
			check(new ModPack({ deleted: true }));
			check(new ModPack({
				name: "Super pack",
				description: "Every option at once.",
				factorio_version: "2.0",
				mods: [
					{ name: "subspace_storage", version: "1.99.8" },
					{ name: "clusterio_lib", version: "0.1.2", sha1: "012345abcd" },
				],
				settings: {
					"startup": {
						"bool-setting": { "value": true },
					},
					"runtime-global": {
						"number-setting": { "value": 123 },
					},
					"runtime-per-user": {
						"string-setting": { "value": "a string" },
					},
				},
				deleted: true,
			}));
		});

		it("should sort integer factorio versions lexicographically", function() {
			let unsortedVersions = ["1.0", "1.1.0", "0.1", "3.0.0", "1.2", "0.3.1", "0.3.3", "2.1.1", "0.0.1"];
			let sortedVersions = ["0.0.1", "0.1", "0.3.1", "0.3.3", "1.0", "1.1.0", "1.2", "2.1.1", "3.0.0"];
			let factorioMods = unsortedVersions.map(v => new ModPack({ factorio_version: v }));
			factorioMods.sort((a, b) => a.integerFactorioVersion - b.integerFactorioVersion);
			assert.deepEqual(factorioMods.map(mod => mod.factorioVersion), sortedVersions);
		});

		describe(".fromModPackString()", function() {
			it("should handle malformed strings", function() {
				assert.throws(
					() => ModPack.fromModPackString("AMalformedString"),
					new Error("Malformed mod pack string: zlib inflate failed")
				);
				assert.throws(
					// eslint-disable-next-line node/no-sync
					() => ModPack.fromModPackString(Buffer.from(zlib.deflateSync("Not Json")).toString("base64")),
					new Error("Malformed mod pack string: Unexpected token N in JSON at position 0")
				);
				assert.throws(
					// eslint-disable-next-line node/no-sync
					() => ModPack.fromModPackString(Buffer.from(zlib.deflateSync('{"i":1}')).toString("base64")),
					new Error("Malformed mod pack string: Schema validation failed")
				);
			});
		});
	});
});
