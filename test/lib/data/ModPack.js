"use strict";
const assert = require("assert").strict;
const zlib = require("zlib");

const libSchema = require("@clusterio/lib/schema");
const ExportManifest = require("@clusterio/lib/data/ExportManifest");
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
				const packStringed = ModPack.fromModPackString(pack.toModPackString());
				packStringed.id = pack.id;
				packStringed.exportManifest = pack.exportManifest;
				assert.deepEqual(packStringed, pack);
			}

			check(new ModPack());
			check(new ModPack({ name: "MyPack" }));
			check(new ModPack({ description: "My Description" }));
			check(new ModPack({ factorio_version: "2.0" }));
			check(new ModPack({ mods: [
				{ name: "subspace_storage", enabled: true, version: "1.99.8" },
				{ name: "clusterio_lib", enabled: true, version: "0.1.2", sha1: "012345abcd" },
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
			check(new ModPack({ export_manifest: { assets: { setting: "settings.json" }}}));
			check(new ModPack({ deleted: true }));
			check(new ModPack({
				name: "Super pack",
				description: "Every option at once.",
				factorio_version: "2.0",
				mods: [
					{ name: "subspace_storage", enabled: true, version: "1.99.8" },
					{ name: "clusterio_lib", enabled: true, version: "0.1.2", sha1: "012345abcd" },
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
				export_manifest: { assets: { setting: "settings.json" }},
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
				let badJsonMsg;
				try {
					JSON.parse("Not Json");
				} catch (err) {
					badJsonMsg = err.message;
				}
				assert.throws(
					// eslint-disable-next-line node/no-sync
					() => ModPack.fromModPackString(Buffer.from(zlib.deflateSync("Not Json")).toString("base64")),
					new Error(`Malformed mod pack string: ${badJsonMsg}`)
				);
				assert.throws(
					// eslint-disable-next-line node/no-sync
					() => ModPack.fromModPackString(Buffer.from(zlib.deflateSync('{"i":1}')).toString("base64")),
					new Error("Malformed mod pack string: Schema validation failed")
				);
			});
		});

		describe("toModSettingsDat()", function() {
			it("should properly serialise settings", function() {
				const pack = new ModPack({ settings: {
					"startup": {
						"bool-setting": { "value": true },
					},
					"runtime-global": {
						"number-setting": { "value": 123 },
					},
					"runtime-per-user": {
						"string-setting": { "value": "a string" },
					},
				}});

				function istr(str) {
					return [
						Uint8Array.from([0, str.length]),
						Buffer.from(str),
					];
				}
				/* eslint-disable indent */
				assert.deepEqual(
					pack.toModSettingsDat(),
					Buffer.concat([
						new Uint8Array(Uint16Array.from([1, 1, 0, 0]).buffer), // version
						Uint8Array.from([0]), // reserved

						Uint8Array.from([5, 0]), // dictionary
						new Uint8Array(Uint32Array.from([3]).buffer), // items

							...istr("startup"), // name
							Uint8Array.from([5, 0]), // dictionary
							new Uint8Array(Uint32Array.from([1]).buffer), // items

								...istr("bool-setting"), // name
								Uint8Array.from([5, 0]), // dictinary
								new Uint8Array(Uint32Array.from([1]).buffer), // items

									...istr("value"), // name
									Uint8Array.from([1, 0, 1]), // boolean

							...istr("runtime-global"), // name
							Uint8Array.from([5, 0]), // dictionary
							new Uint8Array(Uint32Array.from([1]).buffer), // items

								...istr("number-setting"), // name
								Uint8Array.from([5, 0]), // dictinary
								new Uint8Array(Uint32Array.from([1]).buffer), // items

									...istr("value"), // name
									Uint8Array.from([2, 0]), // number
									new Uint8Array(Float64Array.from([123]).buffer),

							...istr("runtime-per-user"), // name
							Uint8Array.from([5, 0]), // dictionary
							new Uint8Array(Uint32Array.from([1]).buffer), // items

								...istr("string-setting"), // name
								Uint8Array.from([5, 0]), // dictinary
								new Uint8Array(Uint32Array.from([1]).buffer), // items

									...istr("value"), // name
									Uint8Array.from([3, 0, 0, "a string".length]), // string
									Buffer.from("a string"),
					])
				);
				/* eslint-enable indent */
			});
		});
	});
});
