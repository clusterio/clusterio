"use strict";
const lib = require("@clusterio/lib");
const assert = require("assert").strict;
const CA = lib.ConfigAccess;


describe("lib/config/classes", function() {
	describe("Config", function() {
		class TestConfig extends lib.Config {
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
			};

			constructor(location, fields) {
				super(location, fields, ["local", "remote"]);
			}
		}

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
		});

		describe(".toJSON()", function() {
			it("should serialize a basic config", function() {
				let testInstance = new TestConfig("local");
				assert.deepEqual(testInstance.toJSON(), {
					"alpha.foo": null,
					"beta.bar": {},
					"test.enum": "b",
					"test.test": null,
					"test.func": 42,
					"test.bool": false,
					"test.json": {},
					"test.rest": {},
					"test.priv": null,
					"test.cred": null,
					"test.rdo": null,
				});
			});
		});

		describe(".toRemote()", function() {
			it("should leave out inaccessible fields", function() {
				let testInstance = new TestConfig("local");
				assert.deepEqual(testInstance.toRemote("remote"), {
					"alpha.foo": null,
					"beta.bar": {},
					"test.enum": "b",
					"test.test": null,
					"test.func": 42,
					"test.bool": false,
					"test.json": {},
					"test.rest": {},
					"test.rdo": null,
				});
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
				};
				let testInstance = TestConfig.fromJSON(testFields, "local");
				assert.deepEqual(testInstance.toJSON(), testFields);
			});

			it("should ignore inaccessible fields", function() {
				let testInstance = TestConfig.fromJSON({ "test.priv": "bad" }, "remote");
				assert.equal(testInstance.fields["test.priv"], undefined);
				assert.equal(testInstance.fields["test.func"], 42);
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
					"extra.blah": true,
					"extra.spam": "baz",
					"alpha.foo": null,
					"beta.bar": { value: 30 },
					"test.bool": false,
					"test.enum": "b",
					"test.func": 42,
					"test.json": {},
					"test.rest": {},
					"test.priv": null,
					"test.cred": null,
					"test.rdo": null,
					"test.test": null,
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

		describe(".set()", function() {
			let testInstance;
			beforeEach(function() {
				testInstance = new TestConfig("local", {
					"test.enum": "a",
					"test.test": "blah",
					"test.func": 27,
				});
			});

			it("should set the value", function() {
				testInstance.set("alpha.foo", "new value");
				assert.equal(testInstance.get("alpha.foo"), "new value");
			});

			it("should throw if field does not exist", function() {
				assert.throws(
					() => testInstance.set("test.bar", 1),
					new lib.InvalidField("No field named 'test.bar'")
				);
			});

			it("should throw if field is remotely inaccessible", function() {
				assert.throws(
					() => testInstance.set("test.priv", "bad", "remote"),
					new lib.InvalidAccess("Field 'test.priv' is not accessible from remote")
				);
			});
			it("should throw if field is locally inaccessible", function() {
				testInstance = new TestConfig("remote");
				assert.throws(
					() => testInstance.set("test.priv", "bad", "local"),
					new lib.InvalidAccess("Field 'test.priv' is not accessible from remote")
				);
			});

			it("should throw if field is not in enum", function() {
				assert.throws(
					() => testInstance.set("test.enum", "bar"),
					new Error("Expected one of [a, b, c], not bar")
				);
			});

			it("should work if field is in enum", function() {
				testInstance.set("test.enum", "c");
				assert.equal(testInstance.get("test.enum"), "c");
			});

			it("should throw if field is not optional", function() {
				assert.throws(
					() => testInstance.set("test.func", null),
					new Error("Field test.func cannot be null")
				);
			});

			it("should work if field is optional", function() {
				testInstance.set("test.test", "spam");
				assert.equal(testInstance.get("test.test"), "spam");
			});

			it("should throw if field is of wrong type", function() {
				assert.throws(
					() => testInstance.set("test.test", 1),
					new Error("Expected type of test.test to be string, not number")
				);
			});

			it("should treat empty string as null", function() {
				testInstance.set("test.test", "");
				assert.equal(testInstance.get("test.test"), null);
			});

			it("should auto convert string to boolean if possible", function() {
				testInstance.set("test.bool", "true");
				assert.equal(testInstance.get("test.bool"), true);
				testInstance.set("test.bool", "false");
				assert.equal(testInstance.get("test.bool"), false);

				assert.throws(
					() => testInstance.set("test.bool", "blah"),
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
					testInstance.set("test.func", s);
					assert.equal(testInstance.get("test.func"), Number.parseFloat(s));
				}

				assert.throws(
					() => testInstance.set("test.func", "blah"),
					new lib.InvalidValue("Expected type of test.func to be number, not string")
				);
			});

			it("should auto convert string to object", function() {
				testInstance.set("test.json", '{"json": true}');
				assert.deepEqual(testInstance.get("test.json"), { json: true });

				let errMsg;
				try {
					JSON.parse("blah");
				} catch (err) {
					errMsg = err.message;
				}
				assert.throws(
					() => testInstance.set("test.json", "blah"),
					new lib.InvalidValue(`Error parsing value for test.json: ${errMsg}`)
				);
			});
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
		});

		describe(".setProp()", function() {
			let testInstance;
			beforeEach(function() {
				testInstance = new TestConfig("local", {
					"test.enum": "a",
					"test.test": "blah",
					"test.func": 27,
				});
			});

			it("should throw if field does not exist", function() {
				assert.throws(
					() => testInstance.setProp("test.bar", 1),
					new lib.InvalidField("No field named 'test.bar'")
				);
			});

			it("should throw if field is remotely inaccessible", function() {
				assert.throws(
					() => testInstance.setProp("test.priv", "prop", "bad", "remote"),
					new lib.InvalidAccess("Field 'test.priv' is not accessible from remote")
				);
			});
			it("should throw if field is locally inaccessible", function() {
				testInstance = new TestConfig("remote");
				assert.throws(
					() => testInstance.setProp("test.priv", "prop", "bad", "local"),
					new lib.InvalidAccess("Field 'test.priv' is not accessible from remote")
				);
			});

			it("should throw if field is not an object", function() {
				assert.throws(
					() => testInstance.setProp("test.enum", "prop", "a"),
					new lib.InvalidField("Cannot set property on non-object field 'test.enum'")
				);
			});

			it("should work if field is an object", function() {
				testInstance.set("test.json", { prev: 32, test: false });
				testInstance.setProp("test.json", "test", true);
				assert.deepEqual(testInstance.get("test.json"), { prev: 32, test: true });
			});

			it("should handle field being null", function() {
				testInstance.set("test.json", null);
				testInstance.setProp("test.json", "test", true);
				assert.deepEqual(testInstance.get("test.json"), { test: true });
			});

			it("should unset field if passed undefined", function() {
				testInstance.set("test.json", { test: true, extra: "yes" });
				testInstance.setProp("test.json", "extra", undefined);
				assert.deepEqual(testInstance.get("test.json"), { test: true });
			});
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
		});
	});
});
