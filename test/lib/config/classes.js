"use strict";
const lib = require("@clusterio/lib");
const assert = require("assert").strict;
const events = require("events");


describe("lib/config/classes", function() {
	describe("Config", function() {
		class TestConfig extends lib.Config {
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
				"test.priv": { access: ["local"], type: "string", optional: true },
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
					"test.priv": null,
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
					"test.priv": null,
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
					"test.priv": null,
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
		});

		describe(".canAccess()", function() {
			it("should throw if field does not exist", function() {
				let testInstance = new TestConfig("local");
				assert.throws(() => testInstance.canAccess("invalid"), new Error("No field named 'invalid'"));
			});

			it("should return true for fields that are accessible", function() {
				let testInstance = new TestConfig("local");
				assert.equal(testInstance.canAccess("alpha.foo"), true);
				for (let field of ["test.enum", "test.test", "test.func", "test.bool", "test.json"]) {
					assert.equal(testInstance.canAccess(field), true);
					assert.equal(testInstance.canAccess(field, "local"), true);
					assert.equal(testInstance.canAccess(field, "remote"), true);
				}
				assert.equal(testInstance.canAccess("test.priv"), true);
				assert.equal(testInstance.canAccess("test.priv", "local"), true);
				assert.equal(testInstance.canAccess("test.priv", "remote"), false);
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
			it("should throw if field is inaccessible", function() {
				let testInstance = new TestConfig("local");
				assert.throws(
					() => testInstance.get("test.priv", "remote"),
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

			it("should throw if field is inaccesible", function() {
				assert.throws(
					() => testInstance.set("test.priv", "bad", "remote"),
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

			it("should throw if field is inaccesible", function() {
				assert.throws(
					() => testInstance.setProp("test.priv", "prop", "bad", "remote"),
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
		});

		describe("fieldChanged event", function() {
			let testInstance;
			let called;
			beforeEach(function() {
				testInstance = new TestConfig("local");
				called = false;
				testInstance.once("fieldChanged", (field, curr, prev) => {
					if (field === "beta.bar") {
						called = true;
					}
				});
			});

			it("should be called when setting a field", function() {
				testInstance.set("beta.bar", { value: 1 });
				assert(called, "fieldChanged was not called");
			});

			it("should be called when updating a config", function() {
				testInstance.update({
					"beta.bar": { value: 1 },
				}, true);
				assert(called, "fieldChanged was not called");
			});

			it("should be called when setting a prop", function() {
				testInstance.setProp("beta.bar", "value", 2);
				assert(called, "fieldChanged was not called");
			});
		});
	});
});
