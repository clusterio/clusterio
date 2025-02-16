"use strict";
const assert = require("assert").strict;
const zlib = require("zlib");

const lib = require("@clusterio/lib");
const { ModPack } = lib;


describe("lib/data/ModPack", function() {
	describe("class ModPack", function() {
		it("should round trip serialize", function() {
			const validate = lib.compile(ModPack.jsonSchema);
			function check(pack) {
				const json = JSON.parse(JSON.stringify(pack));
				if (!validate(json)) {
					throw validate.errors;
				}
				assert.deepEqual(ModPack.fromJSON(json), pack);
				const packStringed = ModPack.fromModPackString(pack.toModPackString());
				packStringed.id = pack.id;
				packStringed.exportManifest = pack.exportManifest;
				assert.deepEqual(packStringed, pack);
			}

			check(ModPack.fromJSON({}));
			check(ModPack.fromJSON({ name: "MyPack" }));
			check(ModPack.fromJSON({ description: "My Description" }));
			check(ModPack.fromJSON({ factorio_version: "2.0" }));
			check(ModPack.fromJSON({ mods: [
				{ name: "clusterio_lib", enabled: true, version: "2.0.20", sha1: "012345abcd" },
			]}));
			check(ModPack.fromJSON({ settings: {
				"startup": {
					"bool-setting": { "value": true },
				},
				"runtime-global": {
					"number-setting": { "value": 123 },
				},
				"runtime-per-user": {
					"string-setting": { "value": "a string" },
					"color-setting": { "value": { "r": 1, "g": 1, "b": 0, "a": 1 } },
				},
			}}));
			check(ModPack.fromJSON({ export_manifest: { assets: { setting: "settings.json" }}}));
			check(ModPack.fromJSON({ deleted: true }));
			check(ModPack.fromJSON({
				name: "Super pack",
				description: "Every option at once.",
				factorio_version: "2.0",
				mods: [
					{ name: "clusterio_lib", enabled: true, version: "2.0.20", sha1: "012345abcd" },
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
						"color-setting": { "value": { "r": 1, "g": 1, "b": 0, "a": 1 } },
					},
				},
				export_manifest: { assets: { setting: "settings.json" }},
				deleted: true,
			}));
		});

		it("should sort integer factorio versions lexicographically", function() {
			let unsortedVersions = ["1.0", "1.1.0", "0.1", "3.0.0", "1.2", "0.3.1", "0.3.3", "2.1.1", "0.0.1"];
			let sortedVersions = ["0.0.1", "0.1", "0.3.1", "0.3.3", "1.0", "1.1.0", "1.2", "2.1.1", "3.0.0"];
			let factorioMods = unsortedVersions.map(v => ModPack.fromJSON({ factorio_version: v }));
			factorioMods.sort((a, b) => a.integerFactorioVersion - b.integerFactorioVersion);
			assert.deepEqual(factorioMods.map(mod => mod.factorioVersion), sortedVersions);
		});

		describe(".fillDefaultSettings()", function() {
			const prototypes = {
				"bool-setting": {
					"bool": {
						name: "bool",
						type: "bool-setting",
						setting_type: "startup",
						default_value: true,
					},
				},
				"double-setting": {
					"number": {
						name: "number",
						type: "double-setting",
						setting_type: "runtime-global",
						default_value: 123,
					},
				},
				"string-setting": {
					"string": {
						name: "string",
						type: "string-setting",
						setting_type: "runtime-per-user",
						default_value: "a string",
					},
				},
				"color-setting": {
					"color": {
						name: "color",
						type: "color-setting",
						setting_type: "runtime-per-user",
						default_value: { "r": 1, "g": 1, "b": 1, "a": 1 },
					},
				},
			};
			const mockLogger = { warn: () => {} };
			it("should fill in defaults for settings", function() {
				const pack = ModPack.fromJSON({});
				pack.fillDefaultSettings(prototypes, mockLogger);
				assert.deepEqual(pack.toJSON().settings, {
					"startup": {
						"bool": { "value": true },
					},
					"runtime-global": {
						"number": { "value": 123 },
					},
					"runtime-per-user": {
						"string": { "value": "a string" },
						"color": { "value": { "r": 1, "g": 1, "b": 1, "a": 1 } },
					},
				});
			});
			it("should not overwrite existing values", function() {
				const pack = ModPack.fromJSON({ settings: {
					"startup": {
						"bool": { "value": false },
					},
					"runtime-global": {
						"number": { "value": 2 },
					},
					"runtime-per-user": {
						"string": { "value": "spam" },
						"color": { "value": { "r": 0, "g": 0.5, "b": 1, "a": 1 } },
					},
				}});
				pack.fillDefaultSettings(prototypes, mockLogger);
				assert.deepEqual(pack.toJSON().settings, {
					"startup": {
						"bool": { "value": false },
					},
					"runtime-global": {
						"number": { "value": 2 },
					},
					"runtime-per-user": {
						"string": { "value": "spam" },
						"color": { "value": { "r": 0, "g": 0.5, "b": 1, "a": 1 } },
					},
				});
			});
			it("should ignore unknown setting_type and missing default_value", function() {
				const pack = ModPack.fromJSON({});
				pack.fillDefaultSettings({
					"string-setting": {
						"foo": {
							name: "foo",
							type: "string-setting",
							setting_type: "magic-that-does-not-exist",
							default_value: "a string",
						},
						"bar": {
							name: "bar",
							type: "string-setting",
							setting_type: "startup",
						},
					},
				}, mockLogger);
				assert.deepEqual(pack.toJSON().settings, {
					"startup": {},
					"runtime-global": {},
					"runtime-per-user": {},
				});
			});
			it("should coerce values of the incorrect type into the correct type", function() {
				const boolDefault = true;
				const intDefault = 123;
				const doubleDefault = 1234.5;
				const stringDefault = "default";
				const colorDefault = { r: 1, g: 0, b: 1, a: 1};
				const settingDefaultValues = {
					"bool-setting": boolDefault,
					"int-setting": intDefault,
					"double-setting": doubleDefault,
					"string-setting": stringDefault,
					"color-setting": colorDefault,
				};
				const possibleValues = ["bool", "int", "double", "string", "color"];
				const settingPrototypes = {
					"bool-setting": {},
					"int-setting": {},
					"double-setting": {},
					"string-setting": {},
					"color-setting": {},
				};
				for (const [type, default_value] of Object.entries(settingDefaultValues)) {
					for (const value of possibleValues) {
						const settingName = `${type}-with-${value}-value`;
						settingPrototypes[type][settingName] = {
							type,
							name: settingName,
							setting_type: "startup",
							default_value,
						};
					}
				};

				const pack = new ModPack();
				const settingValues = {
					"bool": false,
					"int": 1,
					"double": 2.5,
					"string": "str",
					"color": { r: 0, g: 1, b: 0, a: 1 },
				};
				for (const type of Object.keys(settingDefaultValues)) {
					for (const [valueType, value] of Object.entries(settingValues)) {
						pack.settings.startup.set(`${type}-with-${valueType}-value`, { value });
					}
				}
				pack.fillDefaultSettings(settingPrototypes);
				assert.deepEqual(
					pack.settings["startup"],
					new Map([
						["bool-setting-with-bool-value", false],
						["bool-setting-with-int-value", boolDefault],
						["bool-setting-with-double-value", boolDefault],
						["bool-setting-with-string-value", boolDefault],
						["bool-setting-with-color-value", boolDefault],
						["int-setting-with-bool-value", intDefault],
						["int-setting-with-int-value", 1],
						["int-setting-with-double-value", 2.5],
						["int-setting-with-string-value", intDefault],
						["int-setting-with-color-value", intDefault],
						["double-setting-with-bool-value", doubleDefault],
						["double-setting-with-int-value", 1],
						["double-setting-with-double-value", 2.5],
						["double-setting-with-string-value", doubleDefault],
						["double-setting-with-color-value", doubleDefault],
						["string-setting-with-bool-value", "false"],
						["string-setting-with-int-value", "1"],
						["string-setting-with-double-value", "2.5"],
						["string-setting-with-string-value", "str"],
						["string-setting-with-color-value", stringDefault],
						["color-setting-with-bool-value", colorDefault],
						["color-setting-with-int-value", colorDefault],
						["color-setting-with-double-value", colorDefault],
						["color-setting-with-string-value", colorDefault],
						["color-setting-with-color-value", { r: 0, g: 1, b: 0, a: 1}],
					].map(([k, v]) => [k, { value: v }])),
				);
			});
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
				const pack = ModPack.fromJSON({ settings: {
					"startup": {
						"bool-setting": { "value": true },
					},
					"runtime-global": {
						"number-setting": { "value": 123 },
					},
					"runtime-per-user": {
						"string-setting": { "value": "a string" },
						"color-setting": { "value": { "r": 1, "g": 0.5, "b": 0, "a": 1 } },
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
							new Uint8Array(Uint32Array.from([2]).buffer), // items

								...istr("string-setting"), // name
								Uint8Array.from([5, 0]), // dictinary
								new Uint8Array(Uint32Array.from([1]).buffer), // items

									...istr("value"), // name
									Uint8Array.from([3, 0, 0, "a string".length]), // string
									Buffer.from("a string"),

								...istr("color-setting"), // name
								Uint8Array.from([5, 0]), // dictinary
								new Uint8Array(Uint32Array.from([1]).buffer), // items

									...istr("value"), // name
									Uint8Array.from([5, 0]), // dictinary
									new Uint8Array(Uint32Array.from([4]).buffer), // items

										...istr("r"), // name
										Uint8Array.from([2, 0]), // number
										new Uint8Array(Float64Array.from([1]).buffer),

										...istr("g"), // name
										Uint8Array.from([2, 0]), // number
										new Uint8Array(Float64Array.from([0.5]).buffer),

										...istr("b"), // name
										Uint8Array.from([2, 0]), // number
										new Uint8Array(Float64Array.from([0]).buffer),

										...istr("a"), // name
										Uint8Array.from([2, 0]), // number
										new Uint8Array(Float64Array.from([1]).buffer),
					])
				);
				/* eslint-enable indent */
			});
		});
		describe("getBuiltinMods()", function() {
			it("should work with versions before 2.0", function() {
				const builtinMods = ModPack.getBuiltinMods("1.1");
				assert.deepEqual(builtinMods, [
					{ name: "base", enabled: true, version: "1.1" },
				]);
			});
			it("should work with versions after 2.0", function() {
				const builtinMods = ModPack.getBuiltinMods("2.0");
				assert.deepEqual(builtinMods, [
					{ name: "base", enabled: true, version: "2.0" },
					{ name: "elevated-rails", enabled: false, version: "2.0" },
					{ name: "quality", enabled: false, version: "2.0" },
					{ name: "space-age", enabled: false, version: "2.0" },
				]);
			});
		});
		describe("getBuiltinModNames()", function() {
			it("should work with versions before 2.0", function() {
				const builtinModNames = ModPack.getBuiltinModNames("1.1");
				assert.deepEqual(builtinModNames, ["base"]);
			});
			it("should work with versions after 2.0", function() {
				const builtinModNames = ModPack.getBuiltinModNames("2.0");
				assert.deepEqual(builtinModNames, ["base", "elevated-rails", "quality", "space-age"]);
			});
		});
	});
});
