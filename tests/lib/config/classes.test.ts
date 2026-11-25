import t, { type Test } from "tap";
import fs from "node:fs/promises";
import path from "node:path";
import * as lib from "@clusterio/lib";
import { testJsonSerialisable } from "../../shared/json_serialisable.ts";

const CA = lib.ConfigAccess;

// "controller" plays the local side and "host" the remote side in most tests.
class TestConfig extends lib.Config<any> {
	static defaultAccess: lib.ConfigLocation[] = ["controller", "host"];

	static migrations(config: any) {
		if (Object.hasOwn(config, "test.migration")) {
			config["alpha.foo"] = config["test.migration"];
			delete config["test.migration"];
		}
		return config;
	}

	static fieldDefinitions: lib.ConfigDefs<any> = {
		"alpha.foo": { type: "string", optional: true },
		"beta.bar": { type: "object", initialValue: {} },
		"test.enum": {
			type: "string",
			title: "Enum",
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
		"test.priv": { access: ["controller"], type: "string", optional: true },
		"test.cred": { credential: ["controller"], type: "string", optional: true },
		"test.rdo": { readonly: ["controller"], type: "string", optional: true },
		"test.base": { type: "number", initialValue: 1 },
		"test.dependent": {
			type: "number",
			initialValue: 1,
			dependsOn: ["test.base", "test.objDependent"],
			validator(value: number, config: lib.Config<any>) {
				if (value < config.get("test.base")) {
					throw new Error("dependent must be >= base");
				}
				if (config.get("test.objDependent")?.base === 0) {
					throw new Error("objDependent cannot be 0");
				}
			},
		},
		"test.objDependent": {
			type: "object",
			initialValue: {},
			dependsOn: ["test.base"],
			validator(value: any, config: lib.Config<any>) {
				if (value.base && value.base !== config.get("test.base")) {
					throw new Error("base prop must match test.base");
				}
			},
		},
		"test.validated": {
			type: "number",
			optional: true,
			validator(value: number | null) {
				if (value !== null && value < 0) {
					throw new Error("must be positive");
				}
			},
		},
		"test.objValidated": {
			type: "object",
			initialValue: {},
			validator(value: any) {
				if (value && value.bad !== undefined) {
					throw new Error("bad key");
				}
			},
		},
		// Calls the named mutating method on the config it is given
		"test.badValidator": {
			type: "string",
			optional: true,
			dependsOn: ["test.base"],
			validator(value: string | null, config: lib.Config<any>) {
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

// Serialised form of a default TestConfig at "controller"
const defaults: Record<string, unknown> = {
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
	"test.base": 1,
	"test.dependent": 1,
	"test.objDependent": {},
	"test.validated": null,
	"test.objValidated": {},
	"test.badValidator": null,
};

// Every field set to a non default value plus unknown fields
const full: Record<string, unknown> = {
	"alpha.foo": "foo",
	"beta.bar": { value: 20 },
	"test.enum": "a",
	"test.test": "blah",
	"test.func": 50,
	"test.bool": true,
	"test.json": { nested: { deep: [1, 2] } },
	"test.rest": { a: 1 },
	"test.priv": "priv",
	"test.cred": "cred",
	"test.rdo": "rdo",
	"test.base": 2,
	"test.dependent": 3,
	"test.objDependent": { base: 2 },
	"test.validated": 5,
	"test.objValidated": { good: true },
	"test.badValidator": "none",
	"extra.blah": true,
	"extra.spam": "foobar",
	"extra.null": null,
	"extra.obj": { a: 1 },
};

const loaded = { "test.enum": "a", "test.test": "blah", "test.func": 27 };

function testConfig(location: lib.ConfigLocation = "controller", fields?: Record<string, unknown>, filepath?: string) {
	return new TestConfig(location, fields as any, filepath);
}

/** Record fieldChanged events emitted by a config */
function fieldChanges(config: lib.Config<any>) {
	const changes: unknown[][] = [];
	config.on("fieldChanged", (name, curr, prev) => changes.push([name, curr, prev]));
	return changes;
}

/** Log [name, value] for every validator call on TestConfig fields during this test, in call order */
function validatorLog(tt: Test) {
	const log: [string, unknown][] = [];
	for (const [name, def] of Object.entries(TestConfig.fieldDefinitions)) {
		const original = def.validator;
		if (original) {
			tt.capture(def as any, "validator", function(this: any, value: unknown, config: any) {
				log.push([name, value]);
				return original.call(this, value, config);
			});
		}
	}
	return log;
}

/** Error object matcher for t.throws, compares class and message */
t.test("Config", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("throws if location is not a string", async t3 => {
			t3.throws(() => new TestConfig(undefined as any), new Error("location must be a string"));
		});
		t2.test("initialises every readable field", async t3 => {
			t3.strictSame(testConfig().toJSON(), defaults);
		});
		t2.test("leaves out fields the location cannot read", async t3 => {
			const config = testConfig("host") as any;
			t3.equal(config.fields["test.enum"], "b");
			t3.notOk("test.priv" in config.fields);
			t3.notOk("test.cred" in config.fields);
			t3.ok("test.rdo" in config.fields);
		});
		t2.test("loads valid fields", async t3 => {
			const config = testConfig("controller", { ...loaded, "test.bool": null, "test.json": { valid: true } });
			t3.equal(config.get("test.enum"), "a");
			t3.equal(config.get("test.test"), "blah");
			t3.equal(config.get("test.func"), 27);
			t3.equal(config.get("test.bool"), null);
			t3.strictSame(config.get("test.json"), { valid: true });
		});
		t2.test("ignores fields the location cannot write", async t3 => {
			const config = testConfig("host", { "test.priv": "bad", "test.rdo": "bad", "test.test": "ok" }) as any;
			t3.notOk("test.priv" in config.fields);
			t3.equal(config.fields["test.rdo"], null);
			t3.equal(config.fields["test.test"], "ok");
		});
		t2.test("calls initialValue functions after loading stored fields", async t3 => {
			class DerivedConfig extends lib.Config<any> {
				static defaultAccess: lib.ConfigLocation[] = ["controller"];
				static fieldDefinitions: lib.ConfigDefs<any> = {
					"test.base": { type: "number", initialValue: 1 },
					"test.derived": { type: "number", initialValue: (config: any) => config.get("test.base") * 2 },
				};
			}
			t3.equal(new DerivedConfig("controller").get("test.derived"), 2);
			t3.equal(new DerivedConfig("controller", { "test.base": 5 }).get("test.derived"), 10);
			t3.equal(new DerivedConfig("controller", { "test.base": 5, "test.derived": 3 }).get("test.derived"), 3);
			t3.equal(
				new DerivedConfig("controller", { "test.base": 5, "test.derived": "x" }).get("test.derived"), 10,
				"invalid stored value falls back to initialValue",
			);
		});
		t2.test("applies migrations", async t3 => {
			const config = testConfig("controller", { "test.migration": "foo" });
			t3.equal(config.get("alpha.foo"), "foo");
			t3.notOk("test.migration" in config.toJSON());
		});
		t2.test("applies plugin migrations after migrations", async t3 => {
			class HookedConfig extends TestConfig {
				static pluginMigrations = new lib.SyncHook<lib.ConfigSchema>();
			}
			HookedConfig.pluginMigrations.attach(
				"plugin", fields => ({ ...fields, "test.test": `migrated ${fields["alpha.foo"]}` }),
			);
			const config = new HookedConfig("controller", { "test.migration": "foo" });
			t3.equal(config.get("test.test"), "migrated foo");
			t3.equal(new HookedConfig("controller").get("test.test"), null, "not run without stored fields");
		});
		t2.test("writes plugin versions", async t3 => {
			class VersionedConfig extends TestConfig {
				static pluginVersions = new Map([["alpha", "1.2.3"], ["missing", "4.5.6"]]);
				static fieldDefinitions: lib.ConfigDefs<any> = {
					...TestConfig.fieldDefinitions,
					"alpha.version": { type: "string", optional: true },
				};
			}
			t3.test("marks a loaded config dirty when the version changes", async t4 => {
				const config = new VersionedConfig("controller", { "alpha.version": "1.0.0" });
				t4.equal(config.get("alpha.version"), "1.2.3");
				t4.notOk("missing.version" in config.toJSON());
				t4.equal(config.dirty, true);
			});
			t3.test("leaves a loaded config clean when the version matches", async t4 => {
				const config = new VersionedConfig("controller", { "alpha.version": "1.2.3" });
				t4.equal(config.dirty, false);
			});
			t3.test("leaves a new config clean", async t4 => {
				const config = new VersionedConfig("controller");
				t4.equal(config.get("alpha.version"), "1.2.3");
				t4.equal(config.dirty, false);
			});
		});
		t2.test("stores the filepath", async t3 => {
			t3.equal(testConfig("controller", undefined, "filepath").filepath, "filepath");
		});
		t2.test("throws if a required field has no initialValue", async t3 => {
			class BrokenConfig extends lib.Config<any> {
				static fieldDefinitions: lib.ConfigDefs<any> = {
					"test.required": { type: "string" },
				};
			}
			t3.throws(() => new BrokenConfig("controller"));
		});
	});

	t1.test("filepath", async t2 => {
		t2.test("returns the filepath", async t3 => {
			t3.equal(testConfig("controller", undefined, "foo/bar").filepath, "foo/bar");
		});
		t2.test("sets the filepath and the dirty flag", async t3 => {
			const config = testConfig();
			t3.equal(config.filepath, undefined);
			t3.equal(config.dirty, false);
			config.filepath = "foo/bar";
			t3.equal(config.filepath, "foo/bar");
			t3.equal(config.dirty, true);
		});
	});

	t1.test("Config.fieldDependents", async t2 => {
		t2.test("maps fields to the validated fields that depend on them", async t3 => {
			const dependents = TestConfig.fieldDependents;
			t3.strictSame([...dependents.keys()].sort(), ["test.base", "test.objDependent"]);
			t3.strictSame(dependents.get("test.base")!.map((d: { name: string }) => d.name), [
				"test.dependent", "test.objDependent", "test.badValidator",
			]);
			t3.equal(TestConfig.fieldDependents, dependents, "cached");
		});
		t2.test("ignores dependsOn without a validator", async t3 => {
			class NoValidatorConfig extends lib.Config<any> {
				static fieldDefinitions: lib.ConfigDefs<any> = {
					"a": { type: "number", initialValue: 1 },
					"b": { type: "number", initialValue: 1, dependsOn: ["a"] },
				};
			}
			t3.equal(NoValidatorConfig.fieldDependents.size, 0);
		});
		t2.test("is computed per subclass", async t3 => {
			class ParentConfig extends lib.Config<any> {
				static fieldDefinitions: lib.ConfigDefs<any> = {
					"a": { type: "number", initialValue: 1 },
				};
			}
			class ChildConfig extends ParentConfig {
				static fieldDefinitions: lib.ConfigDefs<any> = {
					...ParentConfig.fieldDefinitions,
					"b": { type: "number", initialValue: 1, dependsOn: ["a"], validator() {} },
				};
			}
			t3.equal(ParentConfig.fieldDependents.size, 0);
			t3.equal(ChildConfig.fieldDependents.get("a")?.[0].name, "b");
		});
	});

	t1.test("Config.fromJSON()", async t2 => {
		t2.test("throws on input that is not an object", async t3 => {
			for (const json of [null, undefined, [], "a", 1]) {
				t3.throws(() => TestConfig.fromJSON(json as any, "controller"), new Error("Invalid config"));
			}
		});
		t2.test("throws on field values that are arrays", async t3 => {
			t3.throws(() => TestConfig.fromJSON({ "a": [] as any }, "controller"), new Error("Invalid config"));
		});
		t2.test("loads defaults for missing fields", async t3 => {
			const config = TestConfig.fromJSON({ "alpha.foo": "a", "test.enum": "a" }, "controller");
			t3.strictSame(config.toJSON(), { ...defaults, "alpha.foo": "a", "test.enum": "a" });
		});
		t2.test("preserves unknown fields", async t3 => {
			t3.strictSame(TestConfig.fromJSON(full as any, "controller").toJSON(), full);
		});
		t2.test("ignores inaccessible fields", async t3 => {
			const config = TestConfig.fromJSON({ "test.priv": "bad" }, "host") as any;
			t3.notOk("test.priv" in config.fields);
			t3.equal(config.fields["test.func"], 42);
		});
		t2.test("migrates the pre alpha 14 groups format", async t3 => {
			const config: lib.Config<any> = TestConfig.fromJSON({
				groups: [
					{ name: "alpha", fields: { foo: "a" } },
					{ name: "test", fields: { func: 7, other: "x" } },
				],
			} as any, "controller");
			t3.equal(config.get("alpha.foo"), "a");
			t3.equal(config.get("test.func"), 7);
			t3.equal(config.toJSON()["test.other"], "x");
			t3.notOk("groups" in config.toJSON());
		});
		t2.test("stores the filepath", async t3 => {
			t3.equal(TestConfig.fromJSON({}, "controller", "filepath").filepath, "filepath");
		});
	});

	t1.test("Config.fromFile()", async t2 => {
		t2.test("rejects unreadable and invalid files", async t3 => {
			const dir = t3.testdir({ "bad.json": "abc", "null.json": "null", "array.json": "[]" });
			await t3.rejects(TestConfig.fromFile("controller", path.join(dir, "missing.json")), { code: "ENOENT" });
			await t3.rejects(TestConfig.fromFile("controller", path.join(dir, "bad.json")), SyntaxError);
			for (const file of ["null.json", "array.json"]) {
				const filepath = path.join(dir, file);
				await t3.rejects(TestConfig.fromFile("controller", filepath), new Error("Invalid config"), file);
			}
		});
		t2.test("loads fields and stores the filepath", async t3 => {
			const dir = t3.testdir({ "config.json": JSON.stringify(full) });
			const filepath = path.join(dir, "config.json");
			const config = await TestConfig.fromFile("controller", filepath);
			t3.strictSame(config.toJSON(), full);
			t3.equal(config.filepath, filepath);
			t3.equal(config.dirty, false);
		});
	});

	t1.test("save()", async t2 => {
		const exists = (file: string) => fs.access(file).then(() => true, () => false);

		t2.test("throws if there is no filepath", async t3 => {
			const config = testConfig();
			config.set("alpha.foo", "b");
			await t3.rejects(config.save(), new Error("Cannot save config which has no filepath"));
		});
		t2.test("does nothing when not dirty", async t3 => {
			const filepath = path.join(t3.testdir(), "config.json");
			await testConfig("controller", {}, filepath).save();
			t3.equal(await exists(filepath), false);
		});
		t2.test("saves when forced", async t3 => {
			const filepath = path.join(t3.testdir(), "config.json");
			await testConfig("controller", {}, filepath).save(true);
			t3.strictSame(JSON.parse(await fs.readFile(filepath, "utf8")), defaults);
		});
		t2.test("writes the config as JSON", async t3 => {
			const filepath = path.join(t3.testdir(), "config.json");
			const config = testConfig("controller", full, filepath);
			config.set("alpha.foo", "b");
			await config.save();
			t3.strictSame(JSON.parse(await fs.readFile(filepath, "utf8")), { ...full, "alpha.foo": "b" });
		});
		t2.test("writes the file readable by the owner only", { skip: process.platform === "win32" }, async t3 => {
			const filepath = path.join(t3.testdir(), "config.json");
			const config = testConfig("controller", {}, filepath);
			config.set("alpha.foo", "b");
			await config.save();
			t3.equal((await fs.stat(filepath)).mode & 0o777, 0o600);
		});
		t2.test("clears the dirty flag", async t3 => {
			const filepath = path.join(t3.testdir(), "config.json");
			const config = testConfig("controller", {}, filepath);
			config.set("alpha.foo", "b");
			await config.save();
			t3.equal(config.dirty, false);
			await fs.rm(filepath);
			await config.save();
			t3.equal(await exists(filepath), false);
		});
		t2.test("round trips through fromFile()", async t3 => {
			const filepath = path.join(t3.testdir(), "config.json");
			const config = testConfig("controller", full, filepath);
			config.set("alpha.foo", "b");
			await config.save();
			const reloaded = await TestConfig.fromFile("controller", filepath);
			t3.strictSame(reloaded.toJSON(), config.toJSON());
		});
	});

	t1.test("toJSON()", async t2 => {
		t2.test("serialises a default config", async t3 => {
			t3.strictSame(testConfig().toJSON(), defaults);
		});
		t2.test("leaves out fields the location cannot write", async t3 => {
			const json = testConfig("host").toJSON();
			t3.notOk("test.rdo" in json);
			t3.notOk("test.priv" in json);
			t3.notOk("test.cred" in json);
		});
	});

	t1.test("toRemote()", async t2 => {
		t2.test("leaves out fields the remote cannot read", async t3 => {
			const { "test.cred": _cred, "test.priv": _priv, ...expected } = defaults;
			t3.strictSame(testConfig().toRemote("host"), expected);
		});
		t2.test("filters fields", async t3 => {
			t3.strictSame(testConfig().toRemote("controller", ["alpha.foo"]), { "alpha.foo": null });
		});
		t2.test("skips the local write check at control", async t3 => {
			// control is not in defaultAccess, so nothing is readable or writable there
			const config = testConfig("control") as any;
			config.fields["alpha.foo"] = "x";
			t3.strictSame(config.toRemote("control"), { "alpha.foo": "x" });
			t3.strictSame(config.toRemote("controller"), { "alpha.foo": "x" });
		});
		t2.test("includes unknown fields regardless of filter", async t3 => {
			const config = testConfig("controller", { "extra.a": 1 });
			t3.strictSame(config.toRemote("host", ["alpha.foo"]), { "alpha.foo": null, "extra.a": 1 });
		});
	});

	t1.test("update()", async t2 => {
		t2.test("updates fields and keeps unknown ones", async t3 => {
			const config = testConfig();
			config.update({ "extra.blah": true, "extra.spam": "baz", "beta.bar": { value: 30 } }, false);
			t3.strictSame(config.toJSON(), {
				...defaults, "extra.blah": true, "extra.spam": "baz", "beta.bar": { value: 30 },
			});
		});
		t2.test("skips invalid values", async t3 => {
			const config = testConfig();
			config.update({
				"test.enum": "wrong",
				"test.test": 3,
				"test.func": null,
				"test.bool": "true",
				"beta.bar": null,
			}, false);
			t3.strictSame(config.toJSON(), defaults);
		});
		t2.test("accepts null for optional fields", async t3 => {
			const config = testConfig("controller", { "test.bool": true });
			config.update({ "test.bool": null }, false);
			t3.equal(config.get("test.bool"), null);
		});
		t2.test("skips fields the remote cannot write", async t3 => {
			const config = testConfig();
			config.update({ "test.test": "a", "test.priv": "bad", "test.rdo": "bad" }, false, "host");
			t3.equal(config.get("test.test"), "a");
			t3.equal(config.get("test.priv"), null);
			t3.equal(config.get("test.rdo"), null);
		});
		t2.test("skips the access check at control", async t3 => {
			const config = testConfig("control") as any;
			config.update({ "alpha.foo": "x" }, false, "host");
			t3.equal(config.fields["alpha.foo"], "x");
		});
		t2.test("throws on invalid input", async t3 => {
			const config = testConfig();
			for (const json of [undefined, null, [], "a"]) {
				t3.throws(() => config.update(json as any, false), new Error("Invalid config"));
			}
		});
		t2.test("emits fieldChanged only when notify is true", async t3 => {
			const config = testConfig();
			const changes = fieldChanges(config);
			config.update({ "extra.blah": true, "alpha.foo": "baz", "beta.bar": { value: 30 } }, false);
			t3.strictSame(changes, []);
			config.update({ "extra.blah": false, "alpha.foo": "bam", "beta.bar": { value: 45 } }, true);
			t3.strictSame(changes, [
				["alpha.foo", "bam", "baz"],
				["beta.bar", { value: 45 }, { value: 30 }],
			]);
		});
		t2.test("does not emit for deep equal values", async t3 => {
			const config = testConfig("controller", { "beta.bar": { a: [1] } });
			const changes = fieldChanges(config);
			config.update({ "beta.bar": { a: [1] } }, true);
			t3.strictSame(changes, []);
			t3.equal(config.dirty, false);
		});
		t2.test("sets the dirty flag only when notify is true", async t3 => {
			const config = testConfig();
			config.update({ "alpha.foo": "baz" }, false);
			t3.equal(config.dirty, false);
			config.update({ "alpha.foo": "bam" }, true);
			t3.equal(config.dirty, true);
		});
		t2.test("sets restartRequired only for restart required fields", async t3 => {
			const config = testConfig();
			config.update({ "test.enum": "a" }, false);
			t3.equal(config.restartRequired, false, "notify false");
			config.update({ "alpha.foo": "bam" }, true);
			t3.equal(config.restartRequired, false, "plain field");
			config.update({ "test.enum": "b" }, true);
			t3.equal(config.restartRequired, true, "restart field");
		});
	});

	t1.test("canAccess()", async t2 => {
		t2.test("throws if the field does not exist", async t3 => {
			t3.throws(
				() => testConfig().canAccess("invalid", CA.read),
				new lib.InvalidFieldError("No field named 'invalid'"),
			);
		});
		t2.test("throws if mode is not passed", async t3 => {
			t3.throws(
				() => (testConfig() as any).canAccess("alpha.foo"),
				new TypeError("mode argument is required to canAccess"),
			);
		});
		// field => [read, write, readWrite] from host, all are fully accessible from controller
		const expected: Record<string, [boolean, boolean, boolean]> = {
			"alpha.foo": [true, true, true],
			"test.enum": [true, true, true],
			"test.priv": [false, false, false],
			"test.cred": [false, true, false],
			"test.rdo": [true, false, false],
		};
		for (const [field, [read, write, readWrite]] of Object.entries(expected)) {
			t2.test(`checks access to ${field}`, async t3 => {
				const config = testConfig();
				for (const mode of [CA.read, CA.write, CA.readWrite]) {
					t3.equal(config.canAccess(field, mode), true, `mode ${mode} locally`);
					t3.equal(config.canAccess(field, mode, "controller"), true, `mode ${mode} from controller`);
				}
				t3.equal(config.canAccess(field, CA.read, "host"), read, "read from host");
				t3.equal(config.canAccess(field, CA.write, "host"), write, "write from host");
				t3.equal(config.canAccess(field, CA.readWrite, "host"), readWrite, "readWrite from host");
			});
		}
		t2.test("uses defaultAccess for fields without access", async t3 => {
			t3.equal(testConfig().canAccess("alpha.foo", CA.read, "control"), false);
		});
	});

	t1.test("get()", async t2 => {
		t2.test("throws if the field does not exist", async t3 => {
			t3.throws(() => testConfig().get("invalid"), new lib.InvalidFieldError("No field named 'invalid'"));
		});
		t2.test("returns the field value", async t3 => {
			const config = testConfig("controller", { ...loaded, "test.priv": "blah" });
			t3.equal(config.get("test.enum"), "a");
			t3.equal(config.get("test.priv"), "blah");
			t3.equal(config.get("test.func"), 27);
		});
		t2.test("throws if the field is remotely inaccessible", async t3 => {
			t3.throws(
				() => testConfig().get("test.priv", "host"),
				new lib.InvalidAccessError("Field 'test.priv' is not accessible from host"),
			);
		});
		t2.test("throws if the field is locally inaccessible", async t3 => {
			t3.throws(
				() => testConfig("host").get("test.priv"),
				new lib.InvalidAccessError("Field 'test.priv' is not accessible from host"),
			);
		});
		t2.test("returns write only fields locally", async t3 => {
			const config = testConfig("host");
			config.set("test.cred", "secret");
			t3.equal(config.get("test.cred"), "secret");
		});
	});

	// Behaviour shared by set() and stage(), get reads back where the value went
	function testSetValue(
		tt: Test,
		set: (config: lib.Config<any>, name: string, value: unknown, remote?: lib.ConfigLocation) => void,
		get: (config: lib.Config<any>, name: string) => unknown,
	) {
		tt.test("sets the value", async t3 => {
			const config = testConfig("controller", loaded);
			set(config, "alpha.foo", "new value");
			t3.equal(get(config, "alpha.foo"), "new value");
		});
		tt.test("throws if the field does not exist", async t3 => {
			t3.throws(
				() => set(testConfig(), "test.bar", 1),
				new lib.InvalidFieldError("No field named 'test.bar'"),
			);
		});
		tt.test("throws if the field is remotely inaccessible", async t3 => {
			t3.throws(
				() => set(testConfig(), "test.priv", "bad", "host"),
				new lib.InvalidAccessError("Field 'test.priv' is not accessible from host"),
			);
		});
		tt.test("throws if the field is locally inaccessible", async t3 => {
			t3.throws(
				() => set(testConfig("host"), "test.priv", "bad", "controller"),
				new lib.InvalidAccessError("Field 'test.priv' is not accessible from host"),
			);
		});
		tt.test("throws if the value is not in enum", async t3 => {
			t3.throws(
				() => set(testConfig(), "test.enum", "bar"),
				new lib.InvalidValueError("Expected one of [a, b, c], not bar"),
			);
		});
		tt.test("accepts a value in enum", async t3 => {
			const config = testConfig();
			set(config, "test.enum", "c");
			t3.equal(get(config, "test.enum"), "c");
		});
		tt.test("throws on null for a required field", async t3 => {
			t3.throws(
				() => set(testConfig(), "test.func", null),
				new lib.InvalidValueError("Field test.func cannot be null"),
			);
		});
		tt.test("accepts null for an optional field", async t3 => {
			const config = testConfig("controller", loaded);
			set(config, "test.test", null);
			t3.equal(get(config, "test.test"), null);
		});
		tt.test("throws on the wrong type", async t3 => {
			t3.throws(
				() => set(testConfig(), "test.test", 1),
				new lib.InvalidValueError("Expected type of test.test to be string, not number"),
			);
		});
		tt.test("treats empty string as null", async t3 => {
			const config = testConfig("controller", loaded);
			set(config, "test.test", "");
			t3.equal(get(config, "test.test"), null);
		});
		tt.test("converts strings to booleans", async t3 => {
			const config = testConfig();
			set(config, "test.bool", "true");
			t3.equal(get(config, "test.bool"), true);
			set(config, "test.bool", "false");
			t3.equal(get(config, "test.bool"), false);
			t3.throws(
				() => set(config, "test.bool", "blah"),
				new lib.InvalidValueError("Expected type of test.bool to be boolean, not string"),
			);
		});
		tt.test("converts strings to numbers", async t3 => {
			const config = testConfig();
			for (const s of ["1", "+23", ".23e5", "-.1e-2", "100.0001", "1.", " 7 "]) {
				set(config, "test.func", s);
				t3.equal(get(config, "test.func"), Number.parseFloat(s), s);
			}
			for (const s of ["blah", "1x", "0x10", "NaN", "1e"]) {
				t3.throws(
					() => set(config, "test.func", s),
					new lib.InvalidValueError("Expected type of test.func to be number, not string"),
					s,
				);
			}
		});
		tt.test("rejects Infinity and NaN", async t3 => {
			const config = testConfig();
			for (const s of ["Infinity", "-Infinity"]) {
				t3.throws(
					() => set(config, "test.func", s),
					new lib.InvalidValueError("Expected type of test.func to be number, not string"),
					s,
				);
			}
			for (const n of [Infinity, -Infinity, NaN]) {
				t3.throws(
					() => set(config, "test.func", n),
					new lib.InvalidValueError(`Expected test.func to be a finite number, not ${n}`),
					String(n),
				);
			}
			set(config, "test.func", 1);
			t3.equal(get(config, "test.func"), 1);
		});
		tt.test("converts strings to objects", async t3 => {
			const config = testConfig();
			set(config, "test.json", "{\"json\": true}");
			t3.strictSame(get(config, "test.json"), { json: true });
			t3.throws(
				() => set(config, "test.json", "blah"),
				new lib.InvalidValueError("Error parsing value for test.json: "),
			);
			t3.throws(
				() => set(config, "test.json", "[]"),
				new lib.InvalidValueError("Expected type of test.json to be object, not array"),
			);
		});
	}

	// Behaviour shared by setProp() and stageProp()
	function testSetProp(
		tt: Test,
		setProp: (
			config: lib.Config<any>, name: string, prop: string, value?: unknown, remote?: lib.ConfigLocation,
		) => void,
		get: (config: lib.Config<any>, name: string) => unknown,
	) {
		tt.test("throws if the field does not exist", async t3 => {
			t3.throws(
				() => setProp(testConfig(), "test.bar", "prop", 1),
				new lib.InvalidFieldError("No field named 'test.bar'"),
			);
		});
		tt.test("throws if the field is remotely inaccessible", async t3 => {
			t3.throws(
				() => setProp(testConfig(), "test.priv", "prop", "bad", "host"),
				new lib.InvalidAccessError("Field 'test.priv' is not accessible from host"),
			);
		});
		tt.test("throws if the field is locally inaccessible", async t3 => {
			t3.throws(
				() => setProp(testConfig("host"), "test.priv", "prop", "bad", "controller"),
				new lib.InvalidAccessError("Field 'test.priv' is not accessible from host"),
			);
		});
		tt.test("throws if the field is not an object", async t3 => {
			t3.throws(
				() => setProp(testConfig(), "test.enum", "prop", "a"),
				new lib.InvalidValueError("Cannot set property on non-object field 'test.enum'"),
			);
		});
		tt.test("sets a property", async t3 => {
			const config = testConfig("controller", { "test.json": { prev: 32, test: false } });
			setProp(config, "test.json", "test", true);
			t3.strictSame(get(config, "test.json"), { prev: 32, test: true });
		});
		tt.test("handles the field being null", async t3 => {
			const config = testConfig("controller", { "test.json": null });
			setProp(config, "test.json", "test", true);
			t3.strictSame(get(config, "test.json"), { test: true });
		});
		tt.test("deletes the property when value is undefined", async t3 => {
			const config = testConfig("controller", { "test.json": { test: true, extra: "yes" } });
			setProp(config, "test.json", "extra", undefined);
			t3.strictSame(get(config, "test.json"), { test: true });
		});
		tt.test("does not mutate the previous object", async t3 => {
			const config = testConfig("controller", { "test.json": { a: 1 } });
			const prev = config.get("test.json");
			setProp(config, "test.json", "b", 2);
			t3.strictSame(prev, { a: 1 });
		});
	}

	t1.test("set()", async t2 => {
		testSetValue(t2, (c, ...a) => c.set(...a as [any, any, any]), (c, name) => c.get(name));
		t2.test("emits fieldChanged", async t3 => {
			const config = testConfig("controller", loaded);
			const changes = fieldChanges(config);
			config.set("test.test", "foo");
			config.set("test.test", "foo");
			t3.strictSame(changes, [["test.test", "foo", "blah"]], "not emitted when unchanged");
		});
		t2.test("sets the dirty flag", async t3 => {
			const config = testConfig("controller", loaded);
			config.set("test.test", "foo");
			t3.equal(config.dirty, true);
		});
		t2.test("sets restartRequired only for restart required fields", async t3 => {
			const config = testConfig("controller", loaded);
			config.set("test.test", "foo");
			t3.equal(config.restartRequired, false);
			config.set("test.enum", "b");
			t3.equal(config.restartRequired, true);
		});
		t2.test("runs the field validator", async t3 => {
			const log = validatorLog(t3);
			const config = testConfig();
			config.set("test.validated", 5);
			t3.equal(config.get("test.validated"), 5);
			t3.strictSame(log, [["test.validated", 5]]);
		});
		t2.test("throws if the validator fails", async t3 => {
			const log = validatorLog(t3);
			const config = testConfig();
			t3.throws(
				() => config.set("test.validated", -1),
				new lib.InvalidValueError("Failed validation of test.validated: must be positive"),
			);
			t3.equal(config.get("test.validated"), null);
			t3.strictSame(log, [["test.validated", -1]]);
		});
		t2.test("validates dependent fields against the new value", async t3 => {
			const log = validatorLog(t3);
			const config = testConfig();
			config.set("test.dependent", 10);
			config.set("test.base", 5);
			t3.equal(config.get("test.dependent"), 10);
			t3.equal(config.get("test.base"), 5);
			t3.strictSame(log, [
				["test.dependent", 10],
				["test.dependent", 10],
				["test.objDependent", {}],
				["test.badValidator", null],
			]);
		});
		t2.test("throws if a dependent validator fails", async t3 => {
			const log = validatorLog(t3);
			const config = testConfig();
			t3.throws(
				() => config.set("test.base", 5),
				new lib.InvalidValueError(
					"Failed validation of dependent test.dependent: dependent must be >= base",
				),
			);
			t3.equal(config.get("test.base"), 1);
			t3.strictSame(log, [["test.dependent", 1]]);
		});
		t2.test(
			"validates dependents the remote cannot read",
			async t3 => {
				class CredentialConfig extends lib.Config<any> {
					static fieldDefinitions: lib.ConfigDefs<any> = {
						"a": { type: "number", initialValue: 1 },
						"b": {
							type: "number", initialValue: 1, credential: ["controller"], dependsOn: ["a"],
							validator(value: number, config: lib.Config<any>) {
								if (value < config.get("a")) { throw new Error("b must be >= a"); }
							},
						},
					};
				}
				const config = new CredentialConfig("controller");
				t3.doesNotThrow(() => config.set("a", 0, "host"));
				t3.equal(config.get("a"), 0);
			},
		);
		t2.test("discards staged changes", async t3 => {
			const config = testConfig();
			config.stage("alpha.foo", "staged");
			config.set("test.test", "set");
			t3.equal(config.staging.get("alpha.foo"), null);
		});
	});

	t1.test("setProp()", async t2 => {
		testSetProp(t2, (c, ...a) => c.setProp(...a as [any, any, any, any]), (c, name) => c.get(name));
		t2.test("emits fieldChanged", async t3 => {
			const config = testConfig();
			const changes = fieldChanges(config);
			config.setProp("test.json", "test", true);
			t3.strictSame(changes, [["test.json", { test: true }, {}]]);
		});
		t2.test("sets the dirty flag", async t3 => {
			const config = testConfig();
			config.setProp("test.json", "test", true);
			t3.equal(config.dirty, true);
		});
		t2.test("sets restartRequired only for restart required fields", async t3 => {
			const config = testConfig();
			config.setProp("test.json", "test", true);
			t3.equal(config.restartRequired, false);
			config.setProp("test.rest", "test", true);
			t3.equal(config.restartRequired, true);
		});
		t2.test("runs the field validator", async t3 => {
			const log = validatorLog(t3);
			const config = testConfig();
			config.setProp("test.objValidated", "good", true);
			t3.strictSame(config.get("test.objValidated"), { good: true });
			t3.strictSame(log, [["test.objValidated", { good: true }]]);
		});
		t2.test("throws if the validator fails", async t3 => {
			const log = validatorLog(t3);
			const config = testConfig();
			t3.throws(
				() => config.setProp("test.objValidated", "bad", true),
				new lib.InvalidValueError("Failed validation of test.objValidated: bad key"),
			);
			t3.strictSame(config.get("test.objValidated"), {});
			t3.strictSame(log, [["test.objValidated", { bad: true }]]);
		});
		t2.test("validates dependent fields", async t3 => {
			const log = validatorLog(t3);
			const config = testConfig();
			config.setProp("test.objDependent", "base", 1);
			t3.strictSame(config.get("test.objDependent"), { base: 1 });
			t3.strictSame(log, [
				["test.objDependent", { base: 1 }],
				["test.dependent", 1],
			]);
		});
		t2.test("throws if a dependent validator fails", async t3 => {
			const config = testConfig("controller", { "test.base": 0 });
			const log = validatorLog(t3);
			t3.throws(
				() => config.setProp("test.objDependent", "base", 0),
				new lib.InvalidValueError("Failed validation of dependent test.dependent: objDependent cannot be 0"),
			);
			t3.strictSame(config.get("test.objDependent"), {});
			t3.strictSame(log, [
				["test.objDependent", { base: 0 }],
				["test.dependent", 1],
			]);
		});
	});

	t1.test("staging", async t2 => {
		t2.test("is reused until invalidated", async t3 => {
			const config = testConfig();
			const first = config.staging;
			t3.equal(config.staging, first);
			config.set("alpha.foo", "value");
			t3.not(config.staging, first);
		});
		t2.test("copies the current field values", async t3 => {
			const config = testConfig("controller", full);
			const { "extra.blah": _a, "extra.spam": _b, "extra.null": _c, "extra.obj": _d, ...known } = full;
			t3.strictSame(config.staging.toJSON(), known, "unknown fields are not copied");
		});
	});

	t1.test("stage()", async t2 => {
		testSetValue(t2, (c, ...a) => c.stage(...a as [any, any, any]), (c, name) => c.staging.get(name));
		t2.test("does not change the live value", async t3 => {
			const config = testConfig();
			const changes = fieldChanges(config);
			config.stage("alpha.foo", "value");
			t3.equal(config.get("alpha.foo"), null);
			t3.equal(config.staging.get("alpha.foo"), "value");
			t3.strictSame(changes, []);
			t3.equal(config.dirty, false);
		});
		t2.test("skips validators", async t3 => {
			const log = validatorLog(t3);
			const config = testConfig();
			config.stage("test.validated", -1);
			t3.strictSame(log, []);
		});
	});

	t1.test("stageProp()", async t2 => {
		testSetProp(t2, (c, ...a) => c.stageProp(...a as [any, any, any, any]), (c, name) => c.staging.get(name));
		t2.test("does not change the live value", async t3 => {
			const config = testConfig("controller", { "test.json": { a: 1 } });
			config.stageProp("test.json", "prop", true);
			config.stageProp("test.json", "a", undefined);
			t3.strictSame(config.get("test.json"), { a: 1 });
			t3.strictSame(config.staging.get("test.json"), { prop: true });
		});
	});

	t1.test("commitStaging()", async t2 => {
		t2.test("does nothing without staging", async t3 => {
			const log = validatorLog(t3);
			const config = testConfig();
			config.commitStaging();
			t3.strictSame(config.toJSON(), defaults);
			t3.strictSame(log, []);
		});
		t2.test("commits staged values after running every validator once", async t3 => {
			const log = validatorLog(t3);
			const config = testConfig();
			config.stage("alpha.foo", "value");
			t3.equal(config.get("alpha.foo"), null);
			config.commitStaging();
			t3.equal(config.get("alpha.foo"), "value");
			t3.strictSame(log, [
				["test.dependent", 1],
				["test.objDependent", {}],
				["test.validated", null],
				["test.objValidated", {}],
				["test.badValidator", null],
			]);
		});
		t2.test("throws and keeps live values if a validator fails", async t3 => {
			const log = validatorLog(t3);
			const config = testConfig();
			config.stage("test.validated", -1);
			t3.throws(
				() => config.commitStaging(),
				new lib.InvalidValueError("Failed validation of test.validated: must be positive"),
			);
			t3.equal(config.get("test.validated"), null);
			t3.equal(config.staging.get("test.validated"), -1, "staging is kept");
			t3.strictSame(log, [
				["test.dependent", 1],
				["test.objDependent", {}],
				["test.validated", -1],
			]);
		});
		t2.test("validates the staged values together", async t3 => {
			const config = testConfig();
			t3.throws(() => config.set("test.base", 10), new lib.InvalidValueError("dependent must be >= base"));
			config.stage("test.base", 10);
			config.stage("test.dependent", 15);
			config.commitStaging();
			t3.equal(config.get("test.base"), 10);
			t3.equal(config.get("test.dependent"), 15);
		});
		t2.test("emits fieldChanged for changed fields", async t3 => {
			const config = testConfig();
			const changes = fieldChanges(config);
			config.stage("alpha.foo", "foo");
			config.stage("test.test", "bar");
			config.stage("test.enum", "b");
			config.commitStaging();
			t3.strictSame(changes, [
				["alpha.foo", "foo", null],
				["test.test", "bar", null],
			]);
		});
		t2.test("sets the dirty flag", async t3 => {
			const config = testConfig();
			config.stage("test.test", "foo");
			config.commitStaging();
			t3.equal(config.dirty, true);
		});
		t2.test("sets restartRequired only for restart required fields", async t3 => {
			const config = testConfig();
			config.stage("test.test", "foo");
			config.commitStaging();
			t3.equal(config.restartRequired, false);
			config.stage("test.enum", "a");
			config.commitStaging();
			t3.equal(config.restartRequired, true);
		});
	});

	t1.test("revertStaging()", async t2 => {
		t2.test("discards staged changes", async t3 => {
			const config = testConfig();
			config.stage("alpha.foo", "value");
			config.revertStaging();
			t3.equal(config.staging.get("alpha.foo"), null);
			t3.equal(config.get("alpha.foo"), null);
		});
	});

	t1.test("validators", async t2 => {
		for (const method of ["set", "setProp", "stage", "stageProp", "commitStaging", "revertStaging"]) {
			t2.test(`cannot call ${method}()`, async t3 => {
				const config = testConfig();
				t3.throws(
					() => config.set("test.badValidator", method),
					new lib.InvalidValueError("config is readonly and cannot have values changed"),
				);
				t3.equal(config.get("alpha.foo"), null);
				t3.strictSame(config.get("beta.bar"), {});
			});
			t2.test(`cannot call ${method}() as a dependent validator`, async t3 => {
				const config = testConfig("controller", { "test.base": 0 });
				config.set("test.badValidator", method);
				t3.throws(
					() => config.set("test.base", 1),
					new lib.InvalidValueError("config is readonly and cannot have values changed"),
				);
			});
		}
		t2.test("leave the config writable after they throw", async t3 => {
			const config = testConfig();
			t3.throws(() => config.set("test.validated", -1));
			t3.throws(() => config.set("test.base", 5));
			config.set("alpha.foo", "ok");
			config.stage("test.test", "ok");
			config.commitStaging();
			t3.equal(config.get("test.test"), "ok");
		});
	});
});

t.test("Config._coerceValue()", async t1 => {
	t1.test("checks enum before converting strings", async t2 => {
		const def: lib.FieldDefinition = { type: "number", enum: [1, 2] };
		t2.equal(lib.Config._coerceValue("n", def, 1), 1);
		t2.throws(
			() => lib.Config._coerceValue("n", def, "1"),
			new lib.InvalidValueError("Expected one of [1, 2], not 1"),
		);
	});
	t1.test("passes through non string values of the right type", async t2 => {
		t2.strictSame(lib.Config._coerceValue("o", { type: "object" }, { a: 1 }), { a: 1 });
		t2.equal(lib.Config._coerceValue("b", { type: "boolean" }, true), true);
	});
});

// The Config classes are excluded from the generic JSON round trip because fromJSON needs a location.
t.test("JSON round trip", async t1 => {
	function bound(Class: typeof lib.Config<any>, location: lib.ConfigLocation) {
		return {
			name: Class.name,
			jsonSchema: Class.jsonSchema,
			fromJSON: (json: any) => Class.fromJSON(json, location),
		};
	}

	t1.test("TestConfig", async t2 => {
		testJsonSerialisable(t2, bound(TestConfig, "controller"), [
			["empty sample", {}],
			["full sample", full],
		]);
	});

	const classes: [typeof lib.Config<any>, lib.ConfigLocation[]][] = [
		[lib.ControllerConfig, ["controller"]],
		[lib.HostConfig, ["host"]],
		[lib.InstanceConfig, ["controller", "host"]],
		[lib.CtlConfig, ["control"]],
	];
	for (const [Class, locations] of classes) {
		for (const location of locations) {
			t1.test(`${Class.name} at ${location}`, async t2 => {
				testJsonSerialisable(t2, bound(Class, location), [
					["empty sample", {}],
					["default sample", new Class(location).toJSON()],
				]);
			});
		}
	}
});
