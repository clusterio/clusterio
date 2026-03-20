"use strict";
const lib = require("@clusterio/lib");
const { optional } = require("@clusterio/lib/dist/node/src/config/validators");
const fs = require("fs-extra");
const path = require("path");
const assert = require("assert").strict;
const CA = lib.ConfigAccess;


describe("lib/config/classes", function() {
	describe("Config", function() {
		class TestConfig extends lib.Config {
			static defaultAccess = ["local", "remote"];
			static validatorCalls = [];

			static migrations(config) {
				if (config.hasOwnProperty("test.migration")) {
					config["alpha.foo"] = config["test.migration"];
					delete config["test.migration"];
				}
				return config;
			}

			static fieldDefinitions = {
				"alpha.foo": { type: "string", optional: true },
				"beta.bar": { type: "object", initialValue: {} },
				"test.enum": {
					access: ["local", "remote"],
					type: "string",
					name: "enum",
					title: "Enum",
					description: "Enum thingy",
					restartRequired: true,
					enum: ["a", "b", "c"],
					optional: true,
					initialValue: "b",
				},
				"test.test": { type: "string", optional: true },
				"test.func": { type: "number", initialValue: () => 42 },
				"test.bool": { type: "boolean", initialValue: false, optional: true },
				"test.json": { type: "object", initialValue: {}, optional: true },
				"test.rest": { type: "object", initialValue: {}, optional: true, restartRequired: true },
				"test.priv": { access: ["local"], type: "string", optional: true },
				"test.cred": { credential: ["local"] },
				"test.rdo": { readonly: ["local"] },
				"test.base": { type: "number", initialValue: 1 },
				"test.dependent": {
					type: "number",
					initialValue: 1,
					dependsOn: ["test.base", "test.objDependent"],
					validator(value, config) {
						TestConfig.validatorCalls.push(["test.dependent", value]);
						if (value < config.get("test.base")) {
							throw new Error("dependent must be >= base");
						}
						const dep = config.get("test.objDependent")?.base;
						if (dep === 0) {
							throw new Error("objDependent cannot be 0");
						}
					},
				},
				"test.objDependent": {
					type: "object",
					initialValue: {},
					dependsOn: ["test.base"],
					validator(value, config) {
						TestConfig.validatorCalls.push(["test.objDependent", value]);
						if (value.base && value.base !== config.get("test.base")) {
							throw new Error("base prop must match test.base");
						}
					},
				},
				"test.validated": {
					type: "number",
					optional: true,
					validator(value) {
						TestConfig.validatorCalls.push(["test.validated", value]);
						if (value !== null && value < 0) {
							throw new Error("must be positive");
						}
					},
				},
				"test.objValidated": {
					type: "object",
					initialValue: {},
					validator(value) {
						TestConfig.validatorCalls.push(["test.objValidated", value]);
						if (value && value.bad !== undefined) {
							throw new Error("bad key");
						}
					},
				},
				"test.badValidator": {
					type: "string",
					optional: true,
					dependsOn: ["test.base"],
					validator(value, config) {
						if (config.get("test.base") < 1) {
							return;
						}
						if (value === "set") {
							config.set("alpha.foo", "BAD");
						} else if (value === "setProp") {
							config.setProp("beta.bar", "baz", "BAD");
						} else if (value === "stage") {
							config.stage("alpha.foo", "BAD");
						} else if (value === "stageProp") {
							config.stageProp("beta.bar", "baz", "BAD");
						} else if (value === "commitStaging") {
							config.commitStaging();
						} else if (value === "revertStaging") {
							config.revertStaging();
						}
					},
				},
			};
		}

		const testConfigDefault = Object.fromEntries(
			Object.entries(TestConfig.fieldDefinitions).map(
				([fieldName, fieldDef]) => ([
					fieldName,
					typeof fieldDef.initialValue === "function"
						? fieldDef.initialValue()
						: (fieldDef.initialValue ?? null),
				])
			)
		);

		describe("constructor", function() {
			it("should construct an instance", function() {
				let config = new TestConfig("local");
				assert(config);
			});
			it("should throw if location is not passed", function() {
				assert.throws(
					() => new TestConfig(),
					new Error("location must be a string")
				);
			});
			it("should initialize all fields", function() {
				let testInstance = new TestConfig("local");
				assert.equal(testInstance.get("alpha.foo"), null);
				assert.deepEqual(testInstance.get("beta.bar"), {});
				assert.equal(testInstance.get("test.enum"), "b");
				assert.equal(testInstance.get("test.test"), null);
				assert.equal(testInstance.get("test.func"), 42);
				assert.equal(testInstance.get("test.priv"), null);
			});
			it("should not initalize inaccessible fields", function() {
				let testInstance = new TestConfig("remote");
				assert.equal(testInstance.fields["test.enum"], "b");
				assert.equal(testInstance.fields["test.priv"], undefined);
			});
			it("should apply migrations", function() {
				const config = new TestConfig("local", {
					"test.migration": "foo",
				});
				assert.equal(config.get("alpha.foo"), "foo");
				assert.equal(config.fields["test.migration"], undefined);
			});
			it("should accept a filepath", function() {
				const testInstance = new TestConfig("local", undefined, "filepath");
				assert.equal(testInstance.filepath, "filepath");
			});
			it("should throw if a required field has no initialValue", function() {
				this.skip(); // TODO known bug that was discovered but of of scope for #856
				class BrokenConfig extends lib.Config {
					static fieldDefinitions = {
						"test.required": { type: "string" },
					};
				}

				assert.throws(
					() => new BrokenConfig("local"),
				);
			});
		});

		describe(".toJSON()", function() {
			it("should serialize a basic config", function() {
				const testInstance = new TestConfig("local");
				assert.deepEqual(testInstance.toJSON(), testConfigDefault);
			});
		});

		describe(".toRemote()", function() {
			it("should leave out inaccessible fields", function() {
				const testInstance = new TestConfig("local");
				const { "test.cred": _cred, "test.priv": _priv, ...expected } = testConfigDefault;
				assert.deepEqual(testInstance.toRemote("remote"), expected);
			});
			it("should filter fields when filter argument is provided", function() {
				const testInstance = new TestConfig("local");
				const filtered = testInstance.toRemote("local", ["alpha.foo"]);
				assert.deepEqual(filtered, { "alpha.foo": null });
			});
		});

		describe("static .fromJSON()", function() {
			it("should throw on incorrect input passed", function() {
				assert.throws(
					() => TestConfig.fromJSON(null, "local"),
					new Error("Invalid config")
				);
				assert.throws(
					() => TestConfig.fromJSON(undefined, "local"),
					new Error("Invalid config")
				);
				assert.throws(
					() => TestConfig.fromJSON([], "local"),
					new Error("Invalid config")
				);
			});

			it("should load defaults for missing fields", function() {
				let testInstance = TestConfig.fromJSON({
					"alpha.foo": "a",
					"test.enum": "a",
				}, "local");
				assert.equal(testInstance.get("alpha.foo"), "a");
				assert.deepEqual(testInstance.get("beta.bar"), {});
				assert.equal(testInstance.get("test.enum"), "a");
				assert.equal(testInstance.get("test.test"), null);
				assert.equal(testInstance.get("test.func"), 42);
			});

			it("should load fields", function() {
				let testInstance = TestConfig.fromJSON({
					"test.enum": "c",
					"test.test": "blah",
					"test.func": 22,
					"test.bool": null,
					"test.json": { valid: true },
					"test.priv": "bar",
				}, "local");
				assert.equal(testInstance.get("test.enum"), "c");
				assert.equal(testInstance.get("test.test"), "blah");
				assert.equal(testInstance.get("test.func"), 22);
				assert.equal(testInstance.get("test.bool"), null);
				assert.equal(testInstance.get("test.priv"), "bar");
				assert.deepEqual(testInstance.get("test.json"), { valid: true });
			});

			it("should preserve unknown fields when serialized back", function() {
				let testFields = {
					...testConfigDefault,
					"extra.blah": true,
					"extra.spam": "foobar",
					"alpha.foo": "true",
					"beta.bar": { value: 20 },
					"test.enum": "a",
					"test.test": "blah",
					"test.func": 50,
					"test.bool": false,
					"test.json": {},
					"test.rest": {},
					"test.beta": "decay",
					"test.gamma": 99,
				};
				let testInstance = TestConfig.fromJSON(testFields, "local");
				assert.deepEqual(testInstance.toJSON(), testFields);
			});

			it("should ignore inaccessible fields", function() {
				let testInstance = TestConfig.fromJSON({ "test.priv": "bad" }, "remote");
				assert.equal(testInstance.fields["test.priv"], undefined);
				assert.equal(testInstance.fields["test.func"], 42);
			});
			it("should accept a filepath", function() {
				const testInstance = TestConfig.fromJSON({}, "local", "filepath");
				assert.equal(testInstance.filepath, "filepath");
			});
		});

		describe("static .fromFile", function() {
			const filepath = path.join("temp", "test", "config_test.json");
			it("should throw for file and json errors", async function() {
				await fs.writeFile(filepath, "abc");
				await assert.rejects(TestConfig.fromFile("local", filepath));
				await assert.rejects(TestConfig.fromFile("local", `${filepath}.notExist`));
			});
			it("should throw on incorrect input passed", async function() {
				await fs.writeFile(filepath, "null");
				await assert.rejects(TestConfig.fromFile("local", filepath));
				await fs.writeFile(filepath, "undefined");
				await assert.rejects(TestConfig.fromFile("local", filepath));
				await fs.writeFile(filepath, "[]");
				await assert.rejects(TestConfig.fromFile("local", filepath));
			});
			it("should load defaults for missing fields", async function() {
				await fs.writeJSON(filepath, {
					"alpha.foo": "a",
					"test.enum": "a",
				});
				const testInstance = await TestConfig.fromFile("local", filepath);
				assert.equal(testInstance.get("alpha.foo"), "a");
				assert.deepEqual(testInstance.get("beta.bar"), {});
				assert.equal(testInstance.get("test.enum"), "a");
				assert.equal(testInstance.get("test.test"), null);
				assert.equal(testInstance.get("test.func"), 42);
				assert.equal(testInstance.filepath, filepath);
			});
			it("should load fields", async function() {
				await fs.writeJSON(filepath, {
					"test.enum": "c",
					"test.test": "blah",
					"test.func": 22,
					"test.bool": null,
					"test.json": { valid: true },
					"test.priv": "bar",
				});
				const testInstance = await TestConfig.fromFile("local", filepath);
				assert.equal(testInstance.get("test.enum"), "c");
				assert.equal(testInstance.get("test.test"), "blah");
				assert.equal(testInstance.get("test.func"), 22);
				assert.equal(testInstance.get("test.bool"), null);
				assert.equal(testInstance.get("test.priv"), "bar");
				assert.deepEqual(testInstance.get("test.json"), { valid: true });
				assert.equal(testInstance.filepath, filepath);
			});
			it("should preserve unknown fields", async function() {
				const testFields = {
					...testConfigDefault,
					"extra.blah": true,
					"extra.spam": "foobar",
					"alpha.foo": "true",
					"beta.bar": { value: 20 },
					"test.enum": "a",
					"test.test": "blah",
					"test.func": 50,
					"test.bool": false,
					"test.json": {},
					"test.rest": {},
					"test.beta": "decay",
					"test.gamma": 99,
				};
				await fs.writeJson(filepath, testFields);
				const testInstance = await TestConfig.fromFile("local", filepath);
				assert.deepEqual(testInstance.toJSON(), testFields);
				assert.equal(testInstance.filepath, filepath);
			});
			it("should ignore inaccessible fields", async function() {
				await fs.writeJSON(filepath, { "test.priv": "bad" });
				const testInstance = await TestConfig.fromFile("remote", filepath);
				assert.equal(testInstance.fields["test.priv"], undefined);
				assert.equal(testInstance.fields["test.func"], 42);
				assert.equal(testInstance.filepath, filepath);
			});
		});

		describe(".save()", function() {
			const filepath = path.join("temp", "test", "config_test.json");
			beforeEach(async function() {
				await fs.remove(filepath);
				assert(!await fs.exists(filepath), "File was not removed");
			});
			it("should throw if there is no filepath", async function() {
				const testInstance = new TestConfig("local", { "alpha.foo": "a" });
				testInstance.set("alpha.foo", "b"); // Sets the dirty flag
				await assert.rejects(
					testInstance.save(),
					new Error("Cannot save config which has no filepath")
				);
			});
			it("should do nothing when not dirty", async function() {
				const testInstance = new TestConfig("local", { "alpha.foo": "a" }, filepath);
				await testInstance.save();
				assert(!await fs.exists(filepath), "File was created");
			});
			it("should save data to file", async function() {
				const testInstance = new TestConfig("local", { "alpha.foo": "a" }, filepath);
				testInstance.set("alpha.foo", "b"); // Sets the dirty flag
				await testInstance.save();
				const json = await fs.readJSON(filepath);
				assert.deepEqual(json, testInstance.toJSON());
			});
			it("should clear the dirty flag after saving", async function() {
				const testInstance = new TestConfig("local", { "alpha.foo": "a" }, filepath);
				testInstance.set("alpha.foo", "b"); // Sets the dirty flag
				await testInstance.save();
				assert(await fs.exists(filepath), "File was not created");
				await fs.remove(filepath);
				assert(!await fs.exists(filepath), "File was not removed");
				await testInstance.save();
				assert(!await fs.exists(filepath), "File was created");
			});
			it("should be round trip savable", async function() {
				const testInstance = new TestConfig("local", {
					"extra.blah": true,
					"extra.spam": "foobar",
					"alpha.foo": "true",
					"beta.bar": { value: 20 },
					"test.enum": "a",
					"test.test": "blah",
					"test.func": 50,
					"test.bool": false,
					"test.json": {},
					"test.rest": {},
					"test.priv": null,
					"test.cred": null,
					"test.rdo": null,
					"test.alpha": null,
					"test.beta": "decay",
					"test.gamma": 99,
				}, filepath);
				testInstance.set("alpha.foo", "b"); // Sets the dirty flag
				await testInstance.save();
				const loadedInstance = await TestConfig.fromFile("local", filepath);
				assert.deepEqual(loadedInstance, testInstance);
			});
		});

		describe(".update()", function() {
			it("should update a basic config", function() {
				let testInstance = new TestConfig("local");
				testInstance.update({
					"extra.blah": true,
					"extra.spam": "baz",
					"beta.bar": { value: 30 },
				}, false);
				assert.deepEqual(testInstance.toJSON(), {
					...testConfigDefault,
					"extra.blah": true,
					"extra.spam": "baz",
					"beta.bar": { value: 30 },
				});
			});

			it("should skip updating invalid values", function() {
				let testInstance = new TestConfig("local");
				testInstance.update({
					"test.enum": "wrong",
					"test.test": 3,
					"test.func": null,
				}, false);
				assert.equal(testInstance.get("test.enum"), "b");
				assert.equal(testInstance.get("test.test"), null);
				assert.equal(testInstance.get("test.func"), 42);
			});

			it("should skip updating inaccessible fields", function() {
				let testInstance = new TestConfig("local");
				testInstance.update({
					"test.test": "a",
					"test.priv": "bad",
				}, false, "remote");
				assert.equal(testInstance.get("test.test"), "a");
				assert.equal(testInstance.get("test.priv"), null);
			});

			it("should throw on invalid input", function() {
				let testInstance = new TestConfig("local");
				assert.throws(
					() => testInstance.update(),
					new Error("Invalid config")
				);
				assert.throws(
					() => testInstance.update([], false),
					new Error("Invalid config")
				);
				assert.throws(
					() => testInstance.update(null, false),
					new Error("Invalid config")
				);
			});
			it("should notify fieldChanged listeners", function() {
				const testInstance = new TestConfig("local");

				const changes = [];
				testInstance.on("fieldChanged", (name, value, prev) => changes.push([name, value, prev]));

				testInstance.update({
					"extra.blah": true,
					"alpha.foo": "baz",
					"beta.bar": { value: 30 },
				}, false);

				assert.deepEqual(changes, [], "fieldChanged emitted when notify was false");

				testInstance.update({
					"extra.blah": false,
					"alpha.foo": "bam",
					"beta.bar": { value: 45 },
				}, true);

				assert.deepEqual(changes, [
					["alpha.foo", "bam", "baz"],
					["beta.bar", { value: 45 }, { value: 30 }],
				], "fieldChanged emitted incorrectly");
			});
			it("should set the dirty flag", function() {
				const testInstance = new TestConfig("local");

				testInstance.update({
					"extra.blah": true,
					"alpha.foo": "baz",
					"beta.bar": { value: 30 },
				}, false);

				assert.deepEqual(testInstance.dirty, false, "dirty flag set when notify was false");

				testInstance.update({
					"extra.blah": false,
					"alpha.foo": "bam",
					"beta.bar": { value: 45 },
				}, true);

				assert.deepEqual(testInstance.dirty, true, "dirty flag not set when notify was true");
			});
			it("should set the requires restart flag", function() {
				const testInstance = new TestConfig("local");

				testInstance.update({
					"test.enum": "a",
					"alpha.foo": "baz",
					"beta.bar": { value: 30 },
				}, false);

				assert.deepEqual(testInstance.restartRequired, false, "restart required set when notify was false");

				testInstance.update({
					"alpha.foo": "bam",
					"beta.bar": { value: 45 },
				}, true);

				assert.deepEqual(testInstance.restartRequired, false, "restart required when no restart field changed");

				testInstance.update({
					"test.enum": "b",
				}, true);

				assert.deepEqual(testInstance.restartRequired, true, "restart required not set when notify was true");
			});
		});

		describe(".canAccess()", function() {
			it("should throw if field does not exist", function() {
				let testInstance = new TestConfig("local");
				assert.throws(() => testInstance.canAccess("invalid", CA.read), new Error("No field named 'invalid'"));
			});

			it("should throw if mode is not passed ", function() {
				let testInstance = new TestConfig("local");
				assert.throws(
					() => { testInstance.canAccess("alpha.foo"); },
					new TypeError("mode argument is required to canAccess")
				);
			});

			it("should return true checking read for fields that are readable", function() {
				let testInstance = new TestConfig("local");
				assert.equal(testInstance.canAccess("alpha.foo", CA.read), true);
				for (let field of ["test.enum", "test.test", "test.func", "test.bool", "test.json"]) {
					assert.equal(testInstance.canAccess(field, CA.read), true);
					assert.equal(testInstance.canAccess(field, CA.read, "local"), true);
					assert.equal(testInstance.canAccess(field, CA.read, "remote"), true);
				}
				assert.equal(testInstance.canAccess("test.priv", CA.read), true);
				assert.equal(testInstance.canAccess("test.priv", CA.read, "local"), true);
				assert.equal(testInstance.canAccess("test.priv", CA.read, "remote"), false);
				assert.equal(testInstance.canAccess("test.cred", CA.read), true);
				assert.equal(testInstance.canAccess("test.cred", CA.read, "local"), true);
				assert.equal(testInstance.canAccess("test.cred", CA.read, "remote"), false);
				assert.equal(testInstance.canAccess("test.rdo", CA.read), true);
				assert.equal(testInstance.canAccess("test.rdo", CA.read, "local"), true);
				assert.equal(testInstance.canAccess("test.rdo", CA.read, "remote"), true);
			});
			it("should return true checking write for fields that are writeable", function() {
				let testInstance = new TestConfig("local");
				assert.equal(testInstance.canAccess("alpha.foo", CA.write), true);
				for (let field of ["test.enum", "test.test", "test.func", "test.bool", "test.json"]) {
					assert.equal(testInstance.canAccess(field, CA.write), true);
					assert.equal(testInstance.canAccess(field, CA.write, "local"), true);
					assert.equal(testInstance.canAccess(field, CA.write, "remote"), true);
				}
				assert.equal(testInstance.canAccess("test.priv", CA.write), true);
				assert.equal(testInstance.canAccess("test.priv", CA.write, "local"), true);
				assert.equal(testInstance.canAccess("test.priv", CA.write, "remote"), false);
				assert.equal(testInstance.canAccess("test.cred", CA.write), true);
				assert.equal(testInstance.canAccess("test.cred", CA.write, "local"), true);
				assert.equal(testInstance.canAccess("test.cred", CA.write, "remote"), true);
				assert.equal(testInstance.canAccess("test.rdo", CA.write), true);
				assert.equal(testInstance.canAccess("test.rdo", CA.write, "local"), true);
				assert.equal(testInstance.canAccess("test.rdo", CA.write, "remote"), false);
			});
			it("should return true for checking readWrite for fields that are readable and writeable", function() {
				let testInstance = new TestConfig("local");
				assert.equal(testInstance.canAccess("alpha.foo", CA.readWrite), true);
				for (let field of ["test.enum", "test.test", "test.func", "test.bool", "test.json"]) {
					assert.equal(testInstance.canAccess(field, CA.readWrite), true);
					assert.equal(testInstance.canAccess(field, CA.readWrite, "local"), true);
					assert.equal(testInstance.canAccess(field, CA.readWrite, "remote"), true);
				}
				assert.equal(testInstance.canAccess("test.priv", CA.readWrite), true);
				assert.equal(testInstance.canAccess("test.priv", CA.readWrite, "local"), true);
				assert.equal(testInstance.canAccess("test.priv", CA.readWrite, "remote"), false);
				assert.equal(testInstance.canAccess("test.cred", CA.readWrite), true);
				assert.equal(testInstance.canAccess("test.cred", CA.readWrite, "local"), true);
				assert.equal(testInstance.canAccess("test.cred", CA.readWrite, "remote"), false);
				assert.equal(testInstance.canAccess("test.rdo", CA.readWrite), true);
				assert.equal(testInstance.canAccess("test.rdo", CA.readWrite, "local"), true);
				assert.equal(testInstance.canAccess("test.rdo", CA.readWrite, "remote"), false);
			});
		});

		describe(".get()", function() {
			it("should throw if field does not exist", function() {
				let testInstance = new TestConfig("local");
				assert.throws(() => testInstance.get("invalid"), new Error("No field named 'invalid'"));
			});
			it("should retreive value of field", function() {
				let testInstance = new TestConfig("local", {
					"test.enum": "a",
					"test.priv": "blah",
					"test.func": 27,
				});
				assert.equal(testInstance.get("test.enum"), "a");
				assert.equal(testInstance.get("test.priv"), "blah");
				assert.equal(testInstance.get("test.func"), 27);
			});
			it("should throw if field is remotely inaccessible", function() {
				let testInstance = new TestConfig("local");
				assert.throws(
					() => testInstance.get("test.priv", "remote"),
					new lib.InvalidAccess("Field 'test.priv' is not accessible from remote")
				);
			});
			it("should throw if field is locally inaccessible", function() {
				let testInstance = new TestConfig("remote");
				assert.throws(
					() => testInstance.get("test.priv"),
					new lib.InvalidAccess("Field 'test.priv' is not accessible from remote")
				);
			});
		});

		/**
		 * @param {typeof lib.Config.prototype.set} set
		 * @param {typeof lib.Config.prototype.get} get
		 * @param {(config: lib.Config) => void} replaceConfig
		 */
		function testAccessAndCoerce(set, get, replaceConfig) {
			it("should set the value", function() {
				set("alpha.foo", "new value");
				assert.equal(get("alpha.foo"), "new value");
			});
			it("should throw if field does not exist", function() {
				assert.throws(
					() => set("test.bar", 1),
					new lib.InvalidField("No field named 'test.bar'")
				);
			});
			it("should throw if field is remotely inaccessible", function() {
				assert.throws(
					() => set("test.priv", "bad", "remote"),
					new lib.InvalidAccess("Field 'test.priv' is not accessible from remote")
				);
			});
			it("should throw if field is locally inaccessible", function() {
				replaceConfig(new TestConfig("remote"));
				assert.throws(
					() => set("test.priv", "bad", "local"),
					new lib.InvalidAccess("Field 'test.priv' is not accessible from remote")
				);
			});
			it("should throw if field is not in enum", function() {
				assert.throws(
					() => set("test.enum", "bar"),
					new Error("Expected one of [a, b, c], not bar")
				);
			});
			it("should work if field is in enum", function() {
				set("test.enum", "c");
				assert.equal(get("test.enum"), "c");
			});
			it("should throw if field is not optional", function() {
				assert.throws(
					() => set("test.func", null),
					new Error("Field test.func cannot be null")
				);
			});
			it("should work if field is optional", function() {
				set("test.test", "spam");
				assert.equal(get("test.test"), "spam");
			});
			it("should throw if field is of wrong type", function() {
				assert.throws(
					() => set("test.test", 1),
					new Error("Expected type of test.test to be string, not number")
				);
			});
			it("should treat empty string as null", function() {
				set("test.test", "");
				assert.equal(get("test.test"), null);
			});
			it("should auto convert string to boolean if possible", function() {
				set("test.bool", "true");
				assert.equal(get("test.bool"), true);
				set("test.bool", "false");
				assert.equal(get("test.bool"), false);

				assert.throws(
					() => set("test.bool", "blah"),
					new lib.InvalidValue("Expected type of test.bool to be boolean, not string")
				);
			});
			it("should auto convert string to number if possible", function() {
				for (let s of [
					"1",
					"+23",
					".23e5",
					"-.1e-2",
					"100.0001",
					"Infinity",
				]) {
					set("test.func", s);
					assert.equal(get("test.func"), Number.parseFloat(s));
				}

				assert.throws(
					() => set("test.func", "blah"),
					new lib.InvalidValue("Expected type of test.func to be number, not string")
				);
			});
			it("should auto convert string to object", function() {
				set("test.json", '{"json": true}');
				assert.deepEqual(get("test.json"), { json: true });

				let errMsg;
				try {
					JSON.parse("blah");
				} catch (err) {
					errMsg = err.message;
				}
				assert.throws(
					() => set("test.json", "blah"),
					new lib.InvalidValue(`Error parsing value for test.json: ${errMsg}`)
				);
			});
		}

		describe(".set()", function() {
			let testInstance;
			beforeEach(function() {
				TestConfig.validatorCalls = [];
				testInstance = new TestConfig("local", {
					"test.enum": "a",
					"test.test": "blah",
					"test.func": 27,
				});
			});

			testAccessAndCoerce(
				(...args) => testInstance.set(...args),
				(...args) => testInstance.get(...args),
				config => { testInstance = config; },
			);
			it("should notify fieldChanged listeners", function() {
				const changes = [];
				testInstance.on("fieldChanged", (name, value, prev) => changes.push([name, value, prev]));

				testInstance.set("test.test", "foo");

				assert.deepEqual(changes, [
					["test.test", "foo", "blah"],
				], "fieldChanged emitted incorrectly");
			});
			it("should set the dirty flag", function() {
				testInstance.set("test.test", "foo");
				assert.deepEqual(testInstance.dirty, true, "dirty flag not set");
			});
			it("should set the requires restart flag", function() {
				testInstance.set("test.test", "foo");
				assert.deepEqual(testInstance.restartRequired, false, "restart required when no restart field changed");
				testInstance.set("test.enum", "b");
				assert.deepEqual(testInstance.restartRequired, true, "restart required not set");
			});
			it("should run field validator successfully", function() {
				testInstance.set("test.validated", 5);
				assert.equal(testInstance.get("test.validated"), 5);
				assert.deepEqual(TestConfig.validatorCalls, [
					["test.validated", 5], // set test.validated
				]);
			});
			it("should throw if validator fails", function() {
				assert.throws(
					() => testInstance.set("test.validated", -1),
					new lib.InvalidValue("Failed validation of test.validated: must be positive")
				);
				assert.deepEqual(TestConfig.validatorCalls, [
					["test.validated", -1], // set test.validated
				]);
			});
			it("should validate dependent fields", function() {
				testInstance.set("test.dependent", 10);
				testInstance.set("test.base", 5);
				assert.equal(testInstance.get("test.dependent"), 10);
				assert.equal(testInstance.get("test.base"), 5);
				assert.deepEqual(TestConfig.validatorCalls, [
					["test.dependent", 10], // set test.dependent
					["test.dependent", 10], // set test.base
					["test.objDependent", {}], // set test.base
				]);
			});
			it("should throw if dependent validation fails", function() {
				assert.throws(
					() => testInstance.set("test.base", 5),
					new lib.InvalidValue("Failed validation of dependent test.dependent: dependent must be >= base")
				);
				assert.deepEqual(TestConfig.validatorCalls, [
					["test.dependent", 1], // set test.base
				]);
			});
		});

		/**
		 * @param {typeof lib.Config.prototype.set} set
		 * @param {typeof lib.Config.prototype.setProp} setProp
		 * @param {typeof lib.Config.prototype.get} get
		 * @param {(config: lib.Config) => void} replaceConfig
		 */
		function testAccessAndCoerceProp(set, setProp, get, replaceConfig) {
			it("should throw if field does not exist", function() {
				assert.throws(
					() => setProp("test.bar", 1),
					new lib.InvalidField("No field named 'test.bar'")
				);
			});
			it("should throw if field is remotely inaccessible", function() {
				assert.throws(
					() => setProp("test.priv", "prop", "bad", "remote"),
					new lib.InvalidAccess("Field 'test.priv' is not accessible from remote")
				);
			});
			it("should throw if field is locally inaccessible", function() {
				replaceConfig(new TestConfig("remote"));
				assert.throws(
					() => setProp("test.priv", "prop", "bad", "local"),
					new lib.InvalidAccess("Field 'test.priv' is not accessible from remote")
				);
			});
			it("should throw if field is not an object", function() {
				assert.throws(
					() => setProp("test.enum", "prop", "a"),
					new lib.InvalidField("Cannot set property on non-object field 'test.enum'")
				);
			});
			it("should work if field is an object", function() {
				set("test.json", { prev: 32, test: false });
				setProp("test.json", "test", true);
				assert.deepEqual(get("test.json"), { prev: 32, test: true });
			});
			it("should handle field being null", function() {
				set("test.json", null);
				setProp("test.json", "test", true);
				assert.deepEqual(get("test.json"), { test: true });
			});
			it("should unset field if passed undefined", function() {
				set("test.json", { test: true, extra: "yes" });
				setProp("test.json", "extra", undefined);
				assert.deepEqual(get("test.json"), { test: true });
			});
		}

		describe(".setProp()", function() {
			let testInstance;
			beforeEach(function() {
				TestConfig.validatorCalls = [];
				testInstance = new TestConfig("local", {
					"test.enum": "a",
					"test.test": "blah",
					"test.func": 27,
				});
			});

			testAccessAndCoerceProp(
				(...args) => testInstance.set(...args),
				(...args) => testInstance.setProp(...args),
				(...args) => testInstance.get(...args),
				config => { testInstance = config; },
			);
			it("should notify fieldChanged listeners", function() {
				const changes = [];
				testInstance.on("fieldChanged", (name, value, prev) => changes.push([name, value, prev]));

				testInstance.setProp("test.json", "test", true);

				assert.deepEqual(changes, [
					["test.json", { test: true }, {}],
				], "fieldChanged emitted incorrectly");
			});
			it("should set the dirty flag", function() {
				testInstance.setProp("test.json", "test", true);
				assert.deepEqual(testInstance.dirty, true, "dirty flag not set");
			});
			it("should set the requires restart flag", function() {
				testInstance.setProp("test.json", "test", true);
				assert.deepEqual(testInstance.restartRequired, false, "restart required when no restart field changed");
				testInstance.setProp("test.rest", "test", true);
				assert.deepEqual(testInstance.restartRequired, true, "restart required not set");
			});
			it("should run validator when setting object property", function() {
				testInstance.setProp("test.objValidated", "good", true);
				assert.deepEqual(testInstance.get("test.objValidated"), { good: true });
				assert.deepEqual(TestConfig.validatorCalls, [
					["test.objValidated", { good: true }], // setProp test.objValidated good
				]);
			});
			it("should throw if object validator fails", function() {
				assert.throws(
					() => testInstance.setProp("test.objValidated", "bad", true),
					new lib.InvalidValue("Failed validation of test.objValidated: bad key")
				);
				assert.deepEqual(TestConfig.validatorCalls, [
					["test.objValidated", { bad: true }], // setProp test.objValidated bad
				]);
			});
			it("should validate dependent fields", function() {
				testInstance.setProp("test.objDependent", "base", 1);
				assert.deepEqual(testInstance.get("test.objDependent"), { base: 1 });
				assert.deepEqual(TestConfig.validatorCalls, [
					["test.objDependent", { base: 1 }], // setProp test.objDependent base
					["test.dependent", 1], // setProp test.objDependent base
				]);
			});
			it("should throw if dependent validation fails", function() {
				testInstance.set("test.base", 0);
				assert.throws(
					() => testInstance.setProp("test.objDependent", "base", 0),
					new lib.InvalidValue("Failed validation of dependent test.dependent: objDependent cannot be 0")
				);
				assert.deepEqual(TestConfig.validatorCalls, [
					["test.dependent", 1], // set test.base
					["test.objDependent", {}], // set test.base
					["test.objDependent", { base: 0 }], // setProp test.objDependent base
					["test.dependent", 1], // setProp test.objDependent base
				]);
			});
		});

		describe("get .staging", function() {
			it("should create staging config and reuse it", function() {
				const testInstance = new TestConfig("local");

				const first = testInstance.staging;
				const second = testInstance.staging;

				assert.equal(first, second);
			});
			it("should return new instance if invalided", function() {
				const testInstance = new TestConfig("local");

				const first = testInstance.staging;
				testInstance.set("alpha.foo", "value");
				const second = testInstance.staging;

				assert.notEqual(first, second);
			});
		});

		describe(".stage()", function() {
			let testInstance;
			beforeEach(function() {
				testInstance = new TestConfig("local");
			});

			it("should stage a value without committing", function() {
				testInstance.stage("alpha.foo", "value");

				assert.equal(testInstance.get("alpha.foo"), null);
				assert.equal(testInstance.staging.get("alpha.foo"), "value");
			});
			testAccessAndCoerce(
				(...args) => testInstance.stage(...args),
				(...args) => testInstance.staging.get(...args),
				config => { testInstance = config; },
			);
		});

		describe(".stageProp()", function() {
			let testInstance;
			beforeEach(function() {
				testInstance = new TestConfig("local");
			});

			testAccessAndCoerceProp(
				(...args) => testInstance.stage(...args),
				(...args) => testInstance.stageProp(...args),
				(...args) => testInstance.staging.get(...args),
				config => { testInstance = config; },
			);
			it("should stage object property change", function() {
				testInstance.stageProp("test.json", "prop", true);

				assert.deepEqual(testInstance.get("test.json"), {});
				assert.deepEqual(testInstance.staging.get("test.json"), { prop: true });
			});
			it("should delete property when value undefined", function() {
				testInstance.set("test.json", { a: 1 });

				testInstance.stageProp("test.json", "a", undefined);

				assert.deepEqual(testInstance.staging.get("test.json"), {});
				assert.deepEqual(testInstance.get("test.json"), { a: 1 });
			});
		});

		describe(".commitStaging()", function() {
			let testInstance;
			beforeEach(function() {
				TestConfig.validatorCalls = [];
				testInstance = new TestConfig("local");
			});

			it("should do nothing if staging does not exist", function() {
				testInstance.commitStaging();
				assert.equal(testInstance.get("alpha.foo"), null);
			});
			it("should commit staged values", function() {
				testInstance.stage("alpha.foo", "value");

				assert.equal(testInstance.get("alpha.foo"), null);
				testInstance.commitStaging();
				assert.equal(testInstance.get("alpha.foo"), "value");
				assert.deepEqual(TestConfig.validatorCalls, [
					// commitStaging, all values are checked once
					["test.dependent", 1],
					["test.objDependent", {}],
					["test.validated", null],
					["test.objValidated", {}],
				]);
			});
			it("should throw if staged validation fails", function() {
				testInstance.stage("test.validated", -1);

				assert.throws(
					() => testInstance.commitStaging(),
					new lib.InvalidValue("Failed validation of test.validated: must be positive")
				);
				assert.deepEqual(TestConfig.validatorCalls, [
					// commitStaging, all values are checked once
					["test.dependent", 1],
					["test.objDependent", {}],
					["test.validated", -1], // throws, so no fourth item
				]);
			});
			it("should commit stages values with dependent validation", function() {
				assert.throws(() => testInstance.set("test.base", 10));
				testInstance.stage("test.base", 10);
				testInstance.stage("test.dependent", 15);
				// The above ordering would error if set was used
				testInstance.commitStaging();
				assert.equal(testInstance.get("test.base"), 10);
				assert.equal(testInstance.get("test.dependent"), 15);
				assert.deepEqual(TestConfig.validatorCalls, [
					["test.dependent", 1], // set test.base
					// commitStaging, all values are checked once
					["test.dependent", 15],
					["test.objDependent", {}],
					["test.validated", null],
					["test.objValidated", {}],
				]);
			});
			it("should notify fieldChanged listeners", function() {
				const changes = [];
				testInstance.on("fieldChanged", (name, value, prev) => changes.push([name, value, prev]));

				testInstance.stage("alpha.foo", "foo");
				testInstance.stage("test.test", "bar");
				testInstance.commitStaging();

				assert.deepEqual(changes, [
					["alpha.foo", "foo", null],
					["test.test", "bar", null],
				], "fieldChanged emitted incorrectly");
			});
			it("should set the dirty flag", function() {
				testInstance.stage("test.test", "foo");
				testInstance.commitStaging();
				assert.deepEqual(testInstance.dirty, true, "dirty flag not set");
			});
			it("should set the requires restart flag", function() {
				testInstance.stage("test.test", "foo");
				testInstance.commitStaging();
				assert.deepEqual(testInstance.restartRequired, false, "restart required when no restart field changed");
				testInstance.stage("test.enum", "a");
				testInstance.commitStaging();
				assert.deepEqual(testInstance.restartRequired, true, "restart required not set");
			});
		});

		describe(".revertStaging()", function() {
			it("should discard staged changes", function() {
				const testInstance = new TestConfig("local");
				testInstance.stage("alpha.foo", "value");
				testInstance.revertStaging();
				assert.equal(testInstance.staging.get("alpha.foo"), null);
				assert.equal(testInstance.get("alpha.foo"), null);
			});
		});

		describe("is readonly in validators", function() {
			for (const method of [
				"set", "setProp", "stage", "stageProp", "commitStaging", "revertStaging",
			]) {
				it(`${method} should throw if called inside a validator`, function() {
					const testInstance = new TestConfig("local");
					assert.throws(
						() => testInstance.set("test.badValidator", method),
						/config is readonly and cannot have values changed/
					);
				});
				it(`${method} should throw if called inside a dependent validator`, function() {
					const testInstance = new TestConfig("local");
					testInstance.set("test.base", 0);
					testInstance.set("test.badValidator", method);
					assert.throws(
						() => testInstance.set("test.base", 1),
						/config is readonly and cannot have values changed/
					);
				});
			}
		});
	});
});
