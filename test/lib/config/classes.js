"use strict";
const classes = require("lib/config/classes");
const assert = require("assert").strict;


describe("lib/config/classes", function() {
	describe("ConfigGroup", function() {
		class TestGroup extends classes.ConfigGroup { }
		TestGroup.groupName = "test_group";
		describe(".define()", function() {
			it("should throw if groupName is not set", function() {
				class NoGroupName extends classes.ConfigGroup { }
				assert.throws(
					() => NoGroupName.define({ name: "a", type: "string", optional: true }),
					new Error("Expected ConfigGroup class NoGroupName to have the groupName property set to a string")
				);
			});
			it("should throw on unknown properties", function() {
				assert.throws(
					() => TestGroup.define({ name: "a", type: "string", optional: true, invalid: true }),
					new Error("Unknown property invalid")
				);
			});
			it("should throw on invalid properties", function() {
				for (let [def, error] of [
					[
						{ name: "a", type: "invalid", optional: true },
						"invalid is not a valid type",
					],
					[
						{ name: [], type: "string", optional: true },
						"name must be a string",
					],
					[
						{ name: "a", type: "string", enum: true, optional: true },
						"enum must be an array",
					],
					[
						{ name: "a", title: 2, type: "string", optional: true },
						"title must be a string",
					],
					[
						{ name: "a", description: 2, type: "string", optional: true },
						"description must be a string",
					],
					[
						{ name: "a", type: "string", optional: "yes" },
						"optional must be a boolean",
					],
					[
						{ name: "a", type: "string", initial_value: 1 },
						"initial_value must match the type or be a function",
					],
					[
						{ name: "a", type: "string" },
						"Non-optional field a needs an initial_value",
					],
				]) {
					assert.throws(() => TestGroup.define(def), new Error(error));
				}
			});
			it("should throw on missing properties", function() {
				assert.throws(
					() => TestGroup.define({ type: "string", optional: true }),
					new Error("name is required when defining an field")
				);
				assert.throws(
					() => TestGroup.define({ name: "a", optional: true }),
					new Error("type is required when defining an field")
				);
			});
			it("should allow defining entries", function() {
				TestGroup.define({ name: "test", type: "string", optional: true });
				TestGroup.define({ name: "func", type: "number", initial_value: () => 42 });
				TestGroup.define({ name: "bool", type: "boolean", initial_value: false, optional: true });
				TestGroup.define({ name: "json", type: "object", initial_value: {}, optional: true });

				assert(TestGroup._definitions.has("test"), "field test was not defined");
				assert(TestGroup._definitions.has("func"), "field func was not defined");
				assert(TestGroup._definitions.has("bool"), "field bool was not defined");
				assert(TestGroup._definitions.has("json"), "field json was not defined");
			});

			it("should throw on already defined entries", function() {
				assert.throws(
					() => TestGroup.define({ name: "test", type: "string", optional: true }),
					new Error("Config field test has already been defined")
				);
			});

			it("should set the entries on the class", function() {
				let field = {
					type: "string",
					name: "enum",
					title: "Enum",
					description: "Enum thingy",
					enum: ["a", "b", "c"],
					optional: true,
					initial_value: "b",
				};
				TestGroup.define(field);
				// Generated properties
				field.fullName = "test_group.enum";

				assert.deepEqual(TestGroup._definitions.get("enum"), field);
			});
		});

		describe("get definitions", function() {
			it("should give the field definitions", function() {
				assert.equal(TestGroup.definitions, TestGroup._definitions);
			});
		});

		describe(".finalize()", function() {
			it("should throw if groupName is not set", function() {
				class NoGroupName extends classes.ConfigGroup { }
				assert.throws(
					() => NoGroupName.finalize(),
					new Error("Expected ConfigGroup class NoGroupName to have the groupName property set to a string")
				);
			});
			it("should throw when creating an instance before finalize", function() {
				assert.throws(
					() => new TestGroup(),
					new Error("Cannot instantiate incomplete ConfigGroup class TestGroup")
				);
			});

			it("should not throw", function() {
				TestGroup.finalize();
			});

			it("should throw when calling define after finalize", function() {
				assert.throws(
					() => TestGroup.define({}),
					new Error("Cannot define field for ConfigGroup class TestGroup after it has been finalized")
				);
			});
		});

		describe("constructor", function() {
			it("should create an instance", function() {
				let testInstance = new TestGroup();
			});
		});

		describe(".init()", function() {
			it("should initialize all fields with defaults", async function() {
				let testInstance = new TestGroup();
				await testInstance.init();

				assert.equal(testInstance.get("enum"), "b");
				assert.equal(testInstance.get("test"), null);
				assert.equal(testInstance.get("func"), 42);
			});
		});

		describe("get name", function() {
			it("should give the name of the group", async function() {
				let testInstance = new TestGroup();
				await testInstance.init();
				assert.equal(testInstance.name, "test_group");
			});
		});

		describe(".serialize()", function() {
			it("should serialize a basic group", async function() {
				let testInstance = new TestGroup();
				await testInstance.init();

				assert.deepEqual(testInstance.serialize(), {
					name: "test_group",
					fields: {
						enum: "b",
						test: null,
						func: 42,
						bool: false,
						json: {},
					},
				});
			});
		});

		describe(".load()", function() {
			it("should load a basic group", async function() {
				let testInstance = new TestGroup();
				await testInstance.load(null, { name: "test_group", fields: {
					enum: "c",
					test: "blah",
					func: 22,
					bool: null,
					json: { valid: true },
				}});

				assert.equal(testInstance.get("enum"), "c");
				assert.equal(testInstance.get("test"), "blah");
				assert.equal(testInstance.get("func"), 22);
				assert.equal(testInstance.get("bool"), null);
				assert.deepEqual(testInstance.get("json"), { valid: true });
			});
			it("should load defaults for missing serialized fields", async function() {
				let testInstance = new TestGroup();
				await testInstance.load(null, { name: "test_group", fields: { enum: "a" } });

				assert.equal(testInstance.get("enum"), "a");
				assert.equal(testInstance.get("test"), null);
				assert.equal(testInstance.get("func"), 42);
			});

			it("should preserve unknown fields when serialized back", async function() {
				let testFields = {
					enum: "a",
					test: "blah",
					func: 50,
					bool: false,
					json: {},
					alpha: null,
					beta: "decay",
					gamma: 99,
				};

				let testInstance = new TestGroup();
				await testInstance.load(null, { name: "test_group", fields: testFields });

				assert.deepEqual(testInstance.serialize().fields, testFields);
			});
		});

		describe(".update()", function() {
			it("should skip updating invalid values", async function() {
				let testInstance = new TestGroup();
				await testInstance.init();
				testInstance.update({ name: "test_group", fields: { enum: "wrong", test: 3, func: null }}, false);

				assert.equal(testInstance.get("enum"), "b");
				assert.equal(testInstance.get("test"), null);
				assert.equal(testInstance.get("func"), 42);
			});

			it("should throw on invalid input", function() {
				let testInstance = new TestGroup();
				assert.throws(
					() => testInstance.update(),
					new Error("Expected object, not undefined for ConfigGroup")
				);
				assert.throws(
					() => testInstance.update({}, false),
					new Error("Expected group name test_group, not undefined")
				);
				assert.throws(
					() => testInstance.update({ name: "test_group" }, false),
					new Error("Expected fields to be an object, not undefined")
				);
				assert.throws(
					() => testInstance.update({ name: "test_group", fields: [] }, false),
					new Error("Expected fields to be an object, not array")
				);
				assert.throws(
					() => testInstance.update({ name: "test_group", fields: null }, false),
					new Error("Expected fields to be an object, not null")
				);
			});
		});

		describe(".set()", function() {
			let testInstance;
			before(async function() {
				testInstance = new TestGroup();
				await testInstance.load(null, { name: "test_group", fields: {
					enum: "a", test: "blah", func: 27,
				}});
			});

			it("should throw if field does not exist", function() {
				assert.throws(
					() => testInstance.set("bar", 1),
					new classes.InvalidField("No field named 'bar'")
				);
			});

			it("should throw if field is not in enum", function() {
				assert.throws(
					() => testInstance.set("enum", "bar"),
					new Error("Expected one of [a, b, c], not bar")
				);
			});

			it("should work if field is in enum", function() {
				testInstance.set("enum", "c");
				assert.equal(testInstance.get("enum"), "c");
			});

			it("should throw if field is not optional", function() {
				assert.throws(
					() => testInstance.set("func", null),
					new Error("Field func cannot be null")
				);
			});

			it("should work if field is optional", function() {
				testInstance.set("test", "spam");
				assert.equal(testInstance.get("test"), "spam");
			});

			it("should throw if field is of wrong type", function() {
				assert.throws(
					() => testInstance.set("test", 1),
					new Error("Expected type of test to be string, not number")
				);
			});

			it("should treat empty string as null", function() {
				testInstance.set("test", "");
				assert.equal(testInstance.get("test"), null);
			});

			it("should auto convert string to boolean if possible", function() {
				testInstance.set("bool", "true");
				assert.equal(testInstance.get("bool"), true);
				testInstance.set("bool", "false");
				assert.equal(testInstance.get("bool"), false);

				assert.throws(
					() => testInstance.set("bool", "blah"),
					new classes.InvalidValue("Expected type of bool to be boolean, not string")
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
					testInstance.set("func", s);
					assert.equal(testInstance.get("func"), Number.parseFloat(s));
				}

				assert.throws(
					() => testInstance.set("func", "blah"),
					new classes.InvalidValue("Expected type of func to be number, not string")
				);
			});

			it("should auto convert string to object", function() {
				testInstance.set("json", '{"json": true}');
				assert.deepEqual(testInstance.get("json"), { json: true });

				let errMsg;
				try { JSON.parse("blah"); }
				catch (err) { errMsg = err.message; }
				assert.throws(
					() => testInstance.set("json", "blah"),
					new classes.InvalidValue(`Error parsing value for json: ${errMsg}`)
				);
			});
		});

		describe(".setProp()", function() {
			let testInstance;
			before(async function() {
				testInstance = new TestGroup();
				await testInstance.load(null, { name: "test_group", fields: {
					enum: "a", test: "blah", func: 27,
				}});
			});

			it("should throw if field does not exist", function() {
				assert.throws(
					() => testInstance.setProp("bar", 1),
					new classes.InvalidField("No field named 'bar'")
				);
			});

			it("should throw if field is not an object", function() {
				assert.throws(
					() => testInstance.setProp("enum", "a"),
					new classes.InvalidField("Cannot set property on non-object field 'enum'")
				);
			});

			it("should work if field is an object", function() {
				testInstance.set("json", { prev: 32, test: false });
				testInstance.setProp("json", "test", true);
				assert.deepEqual(testInstance.get("json"), { prev: 32, test: true });
			});

			it("should handle field being null", function() {
				testInstance.set("json", null);
				testInstance.setProp("json", "test", true);
				assert.deepEqual(testInstance.get("json"), { test: true });
			});
		});
	});

	describe("Config", function() {
		class AlphaGroup extends classes.ConfigGroup { }
		AlphaGroup.groupName = "alpha";
		class BetaGroup extends classes.ConfigGroup { }
		BetaGroup.groupName = "beta";
		class TestConfig extends classes.Config { }

		before(function() {
			AlphaGroup.define({ name: "foo", type: "string", optional: true });
			AlphaGroup.finalize();
			TestConfig.registerGroup(AlphaGroup);
			BetaGroup.define({ name: "bar", type: "object", initial_value: {} });
			BetaGroup.finalize();
			TestConfig.registerGroup(BetaGroup);
		});

		describe(".registerGroup()", function() {
			it("should throw if the class is finalized", function() {
				class TestConfig extends classes.Config { }
				TestConfig.finalize();
				class TestGroup extends classes.ConfigGroup { }
				TestGroup.groupName = "test";
				TestGroup.finalize();

				assert.throws(
					() => TestConfig.registerGroup(TestGroup),
					new Error("Cannot register group on finalized config")
				);
			});
			it("should throw if the group is not finalized", function() {
				class UnfinishedGroup extends classes.ConfigGroup { }

				assert.throws(
					() => TestConfig.registerGroup(UnfinishedGroup),
					new Error("Group must be finalized before it can be registered")
				);
			});
			it("should throw if the group is already registered", function() {
				assert.throws(
					() => TestConfig.registerGroup(AlphaGroup),
					new Error("alpha has already been registered")
				);
			});
		});

		describe("constructor", function() {
			it("should throw if config is not finalized", function() {
				assert.throws(
					() => new TestConfig(),
					new Error("Cannot instantiate incomplete Config class TestConfig")
				);
			});
			it("should construct a finalized class", function() {
				TestConfig.finalize();
				let config = new TestConfig();
				assert(config);
			});
		});

		describe(".init()", function() {
			it("should initialize all fields", async function() {
				let testInstance = new TestConfig();
				await testInstance.init();
				assert.equal(testInstance.get("alpha.foo"), null);
				assert.deepEqual(testInstance.get("beta.bar"), {});
			});
		});

		describe(".serialize()", function() {
			it("should serialize a basic config", async function() {
				let testInstance = new TestConfig();
				await testInstance.init();
				assert.deepEqual(testInstance.serialize(), {
					groups: [
						{
							name: "alpha",
							fields: { foo: null },
						},
						{
							name: "beta",
							fields: { bar: {} },
						},
					],
				});
			});
		});

		describe(".load()", function() {
			it("should reject on incorrect input passed", async function() {
				let testInstance = new TestConfig();
				await assert.rejects(
					testInstance.load(null),
					new Error("Expected object, not null for config")
				);
				await assert.rejects(
					testInstance.load(undefined),
					new Error("Expected object, not undefined for config")
				);
				await assert.rejects(
					testInstance.load({ groups: null }),
					new Error("Expected groups to be an array, not null")
				);
			});

			it("should load defaults for missing serialized groups", async function() {
				let testInstance = new TestConfig();
				await testInstance.load({ groups: [{ name: "alpha", fields: { foo: "a" }}] });

				assert.equal(testInstance.get("alpha.foo"), "a");
				assert.deepEqual(testInstance.get("beta.bar"), {});
			});

			it("should preserve unknown groups when serialized back", async function() {
				let testGroups = [
					{
						name: "extra",
						fields: { blah: true, spam: "foobar" },
					},
					{
						name: "alpha",
						fields: { foo: "true" },
					},
					{
						name: "beta",
						fields: { bar: { value: 20 }},
					},
				];

				let testInstance = new TestConfig();
				await testInstance.load({ groups: testGroups });

				assert.deepEqual(testInstance.serialize().groups, testGroups);
			});
		});

		describe(".update()", function() {
			it("should update a basic config", async function() {
				let testInstance = new TestConfig();
				await testInstance.init();
				testInstance.update({ groups: [
					{
						name: "extra",
						fields: { blah: true, spam: "baz" },
					},
					{
						name: "beta",
						fields: { bar: { value: 30 }},
					},
				]}, false);

				assert.deepEqual(testInstance.serialize(), {
					groups: [
						{
							name: "extra",
							fields: { blah: true, spam: "baz" },
						},
						{
							name: "alpha",
							fields: { foo: null },
						},
						{
							name: "beta",
							fields: { bar: { value: 30 }},
						},
					],
				});
			});
		});

		describe(".group()", function() {
			it("should throw if instance is not initialized", function() {
				let testInstance = new TestConfig();
				assert.throws(
					() => testInstance.group("test"),
					new Error("TestConfig instance is uninitialized")
				);
			});
		});

		describe(".get()", function() {
			it("should throw if group does not exist", async function() {
				let testInstance = new TestConfig();
				await testInstance.init();

				assert.throws(() => testInstance.get("invalid"), new Error("No config group named 'invalid'"));
			});

			it("should throw if no field is specified", async function() {
				let testInstance = new TestConfig();
				await testInstance.init();

				assert.throws(() => testInstance.get("alpha"), new Error("No field named ''"));
			});
		});

		describe(".set()", function() {
			it("should set the value", async function() {
				let testInstance = new TestConfig();
				await testInstance.init();

				testInstance.set("alpha.foo", "new value");
				assert.equal(testInstance.get("alpha.foo"), "new value");
			});
		});

		describe("get groups", function() {
			it("should give the registered group classes", function() {
				assert.equal(TestConfig.groups, TestConfig._groups);
			});
		});

		describe("fieldChanged event", function() {
			let testInstance;
			let called;
			beforeEach(async function() {
				testInstance = new TestConfig();
				await testInstance.init();

				called = false;
				testInstance.once("fieldChanged", (group, field, prev) => {
					if (group.name === "beta" && field === "bar") {
						called = true;
					}
				});
			});

			it("should be called when setting a field", async function() {
				testInstance.set("beta.bar", { value: 1 });
				assert(called, "fieldChanged was not called");
			});

			it("should be called when updating a config", async function() {
				testInstance.update({ groups: [{ name: "beta", fields: { bar: { value: 1 }}}]}, true);
				assert(called, "fieldChanged was not called");
			});

			it("should be called when setting a prop", async function() {
				testInstance.setProp("beta.bar", "value", 2);
				assert(called, "fieldChanged was not called");
			});
		});
	});
});
