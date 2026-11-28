/* eslint-disable node/no-sync */
import t from "tap";
import zlib from "node:zlib";
import * as lib from "@clusterio/lib";

const { ModPack, ModInfo } = lib;

function src(version: string) {
	return version as lib.SourceVersion;
}

function info(name: string, version: string, extra: Record<string, unknown> = {}) {
	return ModInfo.fromJSON({ name, version: src(version), title: name, author: "a", ...extra });
}

function record(name: string, version: string, enabled = true, modInfo?: lib.ModInfo): lib.ModRecord {
	return { name, version: src(version), enabled, ...(modInfo ? { info: modInfo } : {}) };
}

function packString(json: unknown) {
	return zlib.deflateSync(typeof json === "string" ? json : JSON.stringify(json)).toString("base64");
}

/** Logger that records warnings */
function warnLogger() {
	const warnings: string[] = [];
	const logger = { warn: (message: string) => { warnings.push(message); } } as unknown as lib.Logger;
	return { logger, warnings };
}

function setting(type: string, settingType: string, name: string, defaultValue?: unknown) {
	return {
		name, type, setting_type: settingType, ...(defaultValue !== undefined ? { default_value: defaultValue } : {}),
	};
}

function prototypes(...settings: ReturnType<typeof setting>[]) {
	const result: Record<string, Record<string, unknown>> = {};
	for (const s of settings) {
		(result[s.type] ??= {})[s.name] = s;
	}
	return result as unknown as lib.ExportSettings;
}

// Encoders for the expected mod-settings.dat bytes
function u32(n: number) {
	return Buffer.from(Uint32Array.from([n]).buffer);
}
function key(str: string) {
	const bytes = Buffer.from(str);
	return Buffer.concat([Buffer.from([0, bytes.length]), bytes]);
}
function dict(entries: [string, Buffer][]) {
	return Buffer.concat([Buffer.from([5, 0]), u32(entries.length), ...entries.flatMap(([k, v]) => [key(k), v])]);
}
function num(n: number) {
	return Buffer.concat([Buffer.from([2, 0]), Buffer.from(Float64Array.from([n]).buffer)]);
}

t.test("getInstalledModUpdates()", async t1 => {
	t1.test("finds the newest installed version for the same Factorio version", async t2 => {
		const pack = [record("a", "1.0.0", true, info("a", "1.0.0", { factorio_version: "2.0" }))];
		const installed = [
			info("a", "1.1.0", { factorio_version: "2.0" }),
			info("a", "1.3.0", { factorio_version: "2.0" }),
			info("a", "1.2.0", { factorio_version: "2.0" }),
		];
		t2.strictSame(lib.getInstalledModUpdates(pack, installed), new Map([["a", "1.3.0"]]));
	});
	t1.test("ignores older, equal, other Factorio and other mod versions", async t2 => {
		const pack = [record("a", "1.0.0", true, info("a", "1.0.0", { factorio_version: "2.0" }))];
		const installed = [
			info("a", "0.9.0", { factorio_version: "2.0" }),
			info("a", "1.0.0", { factorio_version: "2.0" }),
			info("a", "2.0.0", { factorio_version: "1.1" }),
			info("b", "2.0.0", { factorio_version: "2.0" }),
		];
		t2.strictSame(lib.getInstalledModUpdates(pack, installed), new Map());
	});
	t1.test("skips mods without info", async t2 => {
		const installed = [info("a", "2.0.0")];
		t2.strictSame(lib.getInstalledModUpdates([record("a", "1.0.0")], installed), new Map());
	});
});

t.test("applyModRecordAdvisories()", async t1 => {
	t1.test("advises enabling a disabled recommended dependency", async t2 => {
		const mods = [
			record("a", "1.0.0", true, info("a", "1.0.0", { dependencies: ["+ b", "+ c"] })),
			record("b", "1.0.0", false),
		];
		const result = lib.applyModRecordAdvisories(mods);
		t2.strictSame(result.find(m => m.name === "b")!.advisories, [
			{ type: "recommended_dependency", sourceModName: "a" },
		]);
		t2.equal("advisories" in result.find(m => m.name === "a")!, false);
	});
	t1.test("does not advise for enabled targets, wrong versions or other dependency types", async t2 => {
		const mods = [
			record("a", "1.0.0", true, info("a", "1.0.0", { dependencies: ["+ b", "+ c >= 2.0", "d", "? e"] })),
			record("b", "1.0.0", true),
			record("c", "1.0.0", false),
			record("d", "1.0.0", false),
			record("e", "1.0.0", false),
		];
		const result = lib.applyModRecordAdvisories(mods);
		t2.equal(result.some(m => "advisories" in m), false);
	});
	t1.test("ignores recommendations from disabled mods", async t2 => {
		const mods = [
			record("a", "1.0.0", false, info("a", "1.0.0", { dependencies: ["+ b"] })),
			record("b", "1.0.0", false),
		];
		t2.equal(lib.applyModRecordAdvisories(mods).some(m => "advisories" in m), false);
	});
	t1.test("accepts a recommended dependency with a matching version", async t2 => {
		const mods = [
			record("a", "1.0.0", true, info("a", "1.0.0", { dependencies: ["+ b >= 1.0"] })),
			record("b", "1.0.0", false),
		];
		t2.equal(lib.applyModRecordAdvisories(mods)[1].advisories.length, 1);
	});
	t1.test("advises newer available versions only", async t2 => {
		const mods = [record("a", "1.0.0"), record("b", "1.0.0"), record("c", "1.0.0")];
		const updates = new Map([["a", src("1.1.0")], ["b", src("1.0.0")]]);
		const result = lib.applyModRecordAdvisories(mods, updates);
		t2.strictSame(result[0].advisories, [{ type: "update_available", version: "1.1.0" }]);
		t2.equal("advisories" in result[1], false);
		t2.equal("advisories" in result[2], false);
	});
	t1.test("does not modify the input records", async t2 => {
		const mods = [record("a", "1.0.0")];
		lib.applyModRecordAdvisories(mods, new Map([["a", src("2.0.0")]]));
		t2.strictSame(mods, [record("a", "1.0.0")]);
	});
});

t.test("ModPack", async t1 => {
	t1.test("integerFactorioVersion", async t2 => {
		t2.test("orders mod packs by Factorio version", async t3 => {
			const pack = new ModPack();
			pack.factorioVersion = "1.1";
			const older = pack.integerFactorioVersion;
			pack.factorioVersion = "1.1.1";
			t3.ok(older < pack.integerFactorioVersion);
			pack.factorioVersion = "1.10";
			t3.equal(pack.integerFactorioVersion, lib.integerPartialVersion("1.10.0"));
		});
	});

	t1.test("shallowClone()", async t2 => {
		t2.test("copies fields and shares mods and settings", async t3 => {
			const pack = ModPack.fromJSON({
				id: 7, name: "p", description: "d", factorio_version: "2.0", mods: [],
				updated_at_ms: 5, is_deleted: true,
				settings: { "startup": {}, "runtime-global": {}, "runtime-per-user": {} },
				export_manifest: { assets: { settings: "s.json" } },
			});
			const clone = pack.shallowClone();
			t3.not(clone, pack);
			t3.ok(clone instanceof ModPack);
			t3.strictSame(clone, pack);
			t3.equal(clone.mods, pack.mods);
			t3.equal(clone.settings, pack.settings);
			t3.equal(clone.exportManifest, pack.exportManifest);
		});
	});

	t1.test("ModPack.fromJSON()", async t2 => {
		const base = { name: "p", description: "", mods: [], settings: {
			"startup": {}, "runtime-global": {}, "runtime-per-user": {},
		} };
		t2.test("picks a random id when none is given", async t3 => {
			t3.intercept(Math, "random", { value: () => 0.5 });
			t3.equal(ModPack.fromJSON({ ...base, factorio_version: "1.1" }).id, 2 ** 30);
		});
		t2.test("adds missing built in mods", async t3 => {
			const pack = ModPack.fromJSON({ ...base, factorio_version: "2.0" });
			t3.strictSame([...pack.mods.keys()], ["base", "elevated-rails", "quality", "space-age"]);
		});
		t2.test("keeps built in mods that are already listed", async t3 => {
			const pack = ModPack.fromJSON({
				...base, factorio_version: "2.0", mods: [record("space-age", "2.0.7", true)],
			});
			t3.strictSame(pack.mods.get("space-age"), record("space-age", "2.0.7", true));
		});
		t2.test("reads updated_at_ms", async t3 => {
			const pack = ModPack.fromJSON({ ...base, factorio_version: "1.1", updated_at_ms: 12 });
			t3.equal(pack.updatedAtMs, 12);
			t3.equal(pack.toJSON().updated_at_ms, 12);
		});
	});

	t1.test("toModPackString()", async t2 => {
		t2.test("leaves out id, export manifest, update time and deletion", async t3 => {
			const pack = ModPack.fromJSON({
				id: 7, name: "p", description: "d", factorio_version: "1.1", mods: [],
				settings: { "startup": { s: { value: 1 } }, "runtime-global": {}, "runtime-per-user": {} },
				export_manifest: { assets: { settings: "s.json" } }, updated_at_ms: 5, is_deleted: true,
			});
			const json = JSON.parse(zlib.inflateSync(Buffer.from(pack.toModPackString(), "base64")).toString());
			t3.strictSame(json, {
				name: "p", description: "d", factorio_version: "1.1",
				mods: [{ name: "base", enabled: true, version: "1.1.0" }],
				settings: { "startup": { s: { value: 1 } }, "runtime-global": {}, "runtime-per-user": {} },
			});
		});
		t2.test("round trips through fromModPackString()", async t3 => {
			const pack = ModPack.fromJSON({
				name: "p", description: "d", factorio_version: "2.0", mods: [record("a", "1.0.0", false)],
				settings: { "startup": {}, "runtime-global": { g: { value: "x" } }, "runtime-per-user": {} },
			});
			const copy = ModPack.fromModPackString(pack.toModPackString());
			copy.id = pack.id;
			t3.strictSame(copy, pack);
		});
	});

	t1.test("ModPack.fromModPackString()", async t2 => {
		t2.test("throws on data that is not zlib", async t3 => {
			t3.throws(
				() => ModPack.fromModPackString("AMalformedString"),
				new Error("Malformed mod pack string: zlib inflate failed"),
			);
		});
		t2.test("throws on data that is not JSON", async t3 => {
			t3.throws(
				() => ModPack.fromModPackString(packString("Not Json")),
				{ message: /^Malformed mod pack string: Unexpected token/ },
			);
		});
		t2.test("throws on JSON that does not match the schema", async t3 => {
			t3.throws(
				() => ModPack.fromModPackString(packString({ i: 1 })),
				new Error("Malformed mod pack string: Schema validation failed"),
			);
		});
		t2.test("passes on inflate errors that are not zlib data errors", async t3 => {
			const error = Object.assign(new RangeError("Cannot create a Buffer larger than 4 GiB"), {
				code: "ERR_BUFFER_TOO_LARGE",
			});
			t3.intercept(zlib, "inflateSync", { value: () => { throw error; } });
			t3.throws(
				() => ModPack.fromModPackString(packString({ name: "p" })),
				error,
			);
		});
	});

	t1.test("toModSettingsDat()", async t2 => {
		t2.test("writes the version and every setting type", async t3 => {
			const pack = ModPack.fromJSON({
				name: "", description: "", factorio_version: "2.0.11", mods: [],
				settings: {
					"startup": { b: { value: true }, f: { value: false } },
					"runtime-global": { n: { value: 1.5 } },
					"runtime-per-user": { s: { value: "é" }, c: { value: { r: 1, g: 0.5, b: 0, a: 1 } } },
				},
			});
			const value = (v: Buffer) => dict([["value", v]]);
			t3.strictSame(pack.toModSettingsDat(), Buffer.concat([
				Buffer.from(Uint16Array.from([2, 0, 11, 0]).buffer), Buffer.from([0]),
				dict([
					["startup", dict([
						["b", value(Buffer.from([1, 0, 1]))],
						["f", value(Buffer.from([1, 0, 0]))],
					])],
					["runtime-global", dict([["n", value(num(1.5))]])],
					["runtime-per-user", dict([
						["s", value(Buffer.concat([Buffer.from([3, 0, 0, 2]), Buffer.from("é")]))],
						["c", value(dict([["r", num(1)], ["g", num(0.5)], ["b", num(0)], ["a", num(1)]]))],
					])],
				]),
			]));
		});
		t2.test("writes a zero patch for major.minor versions", async t3 => {
			const pack = new ModPack();
			pack.factorioVersion = "1.1";
			t3.strictSame(pack.toModSettingsDat().subarray(0, 9), Buffer.from([1, 0, 1, 0, 0, 0, 0, 0, 0]));
		});
		t2.test("writes long strings with a 32 bit length", async t3 => {
			const pack = new ModPack();
			const long = "x".repeat(300);
			pack.settings.startup.set("s", { value: long });
			const dat = pack.toModSettingsDat();
			const expected = Buffer.concat([Buffer.from([3, 0, 0, 0xff]), u32(300), Buffer.from(long)]);
			t3.not(dat.indexOf(Buffer.concat([key("value"), expected])), -1);
		});
	});

	t1.test("fillDefaultSettings()", async t2 => {
		t2.test("fills in missing settings with their defaults", async t3 => {
			const pack = new ModPack();
			const { logger, warnings } = warnLogger();
			pack.fillDefaultSettings(prototypes(
				setting("bool-setting", "startup", "b", true),
				setting("int-setting", "runtime-global", "i", 3),
				setting("double-setting", "runtime-global", "d", 0.5),
				setting("string-setting", "runtime-per-user", "s", "x"),
				setting("color-setting", "runtime-per-user", "c", [255, 0, 0]),
			), logger);
			t3.strictSame(pack.toJSON().settings, {
				"startup": { b: { value: true } },
				"runtime-global": { i: { value: 3 }, d: { value: 0.5 } },
				"runtime-per-user": { s: { value: "x" }, c: { value: { r: 1, g: 0, b: 0, a: 1 } } },
			});
			t3.strictSame(warnings, []);
		});
		t2.test("keeps existing values of the right type", async t3 => {
			const pack = new ModPack();
			pack.settings.startup.set("b", { value: false });
			pack.settings.startup.set("i", { value: 7 });
			pack.settings.startup.set("s", { value: "kept" });
			pack.settings.startup.set("c", { value: { r: 0, g: 0, b: 1, a: 1 } });
			pack.fillDefaultSettings(prototypes(
				setting("bool-setting", "startup", "b", true),
				setting("int-setting", "startup", "i", 3),
				setting("string-setting", "startup", "s", "x"),
				setting("color-setting", "startup", "c", { r: 1, g: 1, b: 1, a: 1 }),
			), warnLogger().logger);
			t3.strictSame(pack.toJSON().settings.startup, {
				b: { value: false }, i: { value: 7 }, s: { value: "kept" }, c: { value: { r: 0, g: 0, b: 1, a: 1 } },
			});
		});
		t2.test("replaces values of the wrong type", async t3 => {
			const pack = new ModPack();
			pack.settings.startup.set("b", { value: "yes" });
			pack.settings.startup.set("i", { value: true });
			pack.settings.startup.set("d", { value: "1" });
			pack.settings.startup.set("c", { value: 5 });
			pack.fillDefaultSettings(prototypes(
				setting("bool-setting", "startup", "b", true),
				setting("int-setting", "startup", "i", 3),
				setting("double-setting", "startup", "d", 0.5),
				setting("color-setting", "startup", "c", { r: 1, g: 1, b: 1, a: 1 }),
			), warnLogger().logger);
			t3.strictSame(pack.toJSON().settings.startup, {
				b: { value: true }, i: { value: 3 }, d: { value: 0.5 }, c: { value: { r: 1, g: 1, b: 1, a: 1 } },
			});
		});
		t2.test("converts scalar values of string settings to strings", async t3 => {
			const pack = new ModPack();
			pack.settings.startup.set("b", { value: false });
			pack.settings.startup.set("n", { value: 2.5 });
			pack.settings.startup.set("c", { value: { r: 0, g: 0, b: 0, a: 0 } });
			pack.fillDefaultSettings(prototypes(
				setting("string-setting", "startup", "b", "x"),
				setting("string-setting", "startup", "n", "x"),
				setting("string-setting", "startup", "c", "x"),
			), warnLogger().logger);
			t3.strictSame(pack.toJSON().settings.startup, {
				b: { value: "false" }, n: { value: "2.5" }, c: { value: "x" },
			});
		});
		t2.test("warns about and skips unusable prototypes", async t3 => {
			const pack = new ModPack();
			const { logger, warnings } = warnLogger();
			const settings = prototypes(
				setting("string-setting", "magic", "a", "x"),
				setting("string-setting", "startup", "b"),
			);
			(settings as any)["unknown-setting"] = { u: setting("unknown-setting", "startup", "u", 1) };
			pack.fillDefaultSettings(settings, logger);
			t3.strictSame(pack.toJSON().settings, { "startup": {}, "runtime-global": {}, "runtime-per-user": {} });
			t3.strictSame(warnings, [
				"Ignoring a with unknown setting_type magic",
				"Ignoring b with missing default_value",
			]);
		});
	});

	t1.test("ModPack.defaultModPacks", async t2 => {
		t2.test("has a base game and Space Age pack per version", async t3 => {
			const summary = ModPack.defaultModPacks.map(pack => [
				pack.name, pack.factorioVersion, [...pack.mods.values()].filter(m => m.enabled).map(m => m.name),
			]);
			t3.strictSame(summary, [
				["Base Game 0.17", "0.17", ["base"]],
				["Base Game 0.18", "0.18", ["base"]],
				["Base Game 1.0", "1.0", ["base"]],
				["Base Game 1.1", "1.1", ["base"]],
				["Base Game 2.0", "2.0", ["base"]],
				["Base Game 2.1", "2.1", ["base"]],
				["Space Age 2.0", "2.0", ["elevated-rails", "quality", "space-age", "base"]],
				["Space Age 2.1", "2.1", ["elevated-rails", "quality", "space-age", "recycler", "base"]],
			]);
		});
	});

	t1.test("ModPack.getBuiltinMods()", async t2 => {
		t2.test("has only base before 2.0", async t3 => {
			t3.strictSame(ModPack.getBuiltinMods("1.1"), [record("base", "1.1.0")]);
		});
		t2.test("adds the disabled Space Age mods from 2.0", async t3 => {
			t3.strictSame(ModPack.getBuiltinMods("2.0.5"), [
				record("base", "2.0.5"),
				record("elevated-rails", "2.0.5", false),
				record("quality", "2.0.5", false),
				record("space-age", "2.0.5", false),
			]);
		});
		t2.test("adds the disabled recycler from 2.1", async t3 => {
			t3.strictSame(ModPack.getBuiltinMods("2.1.3"), [
				record("base", "2.1.3"),
				record("elevated-rails", "2.1.3", false),
				record("quality", "2.1.3", false),
				record("space-age", "2.1.3", false),
				record("recycler", "2.1.3", false),
			]);
		});
	});

	t1.test("ModPack.getBuiltinModNames()", async t2 => {
		t2.test("lists the names of the builtin mods", async t3 => {
			t3.strictSame(ModPack.getBuiltinModNames("2.1"), [
				"base", "elevated-rails", "quality", "space-age", "recycler",
			]);
		});
	});
});
