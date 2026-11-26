import path from "node:path";
import { pathToFileURL } from "node:url";
import t from "tap";
import * as lib from "@clusterio/lib";

// Entrypoints shared by every test, they are only read
const dir = t.testdir({
	"base.js": `export class Base {
		constructor(context) { this.context = context; this.detached = false; }
		static fromContext(context) { return new this(context); }
		async init() {}
		detachHooks() { this.detached = true; this.context.record.detached = this; }
	}`,
	"function.js": `export default async function(context) {
		context.record.loadedWith = context;
		return { api: true };
	}`,
	"sync_function.js": "export default function() { return 42; }",
	"class.js": `import { Base } from "./base.js";
		export class Plugin extends Base {
			async init() { this.context.record.loadedWith = this; }
		}`,
	"throwing_class.js": `import { Base } from "./base.js";
		export class Plugin extends Base {
			async init() { throw new Error("init failed"); }
		}`,
	"empty.js": "",
	"default_object.js": "export default { notAFunction: true };",
	"wrong_parent.js": "export class Plugin {};\n",
	"not_class.js": "export const Plugin = 1;\n",
	"syntax_error.js": "export default function( {",
	"installation_error.js": `import { InstallationError } from "@clusterio/lib";
		export default function() { throw new InstallationError("missing dependency"); }`,
	"throwing.js": `export default async function({ plugin }) {
		await new Promise(resolve => setTimeout(resolve, plugin.delay ?? 0));
		throw new Error(\`\${plugin.name} failed\`);
	}`,
	// Waits for the plugin named in plugin.waitFor and returns what it got
	"waiting.js": `export default async function({ plugin, plugins }) {
		const got = plugin.waitFor ? await plugins.waitFor(plugin.waitFor, plugin.timeoutMs) : undefined;
		return { name: plugin.name, got };
	}`,
	"migrations.js": `export default function(context) {
		context.hooks.controllerConfig.attach(context.plugin.name, config => {
			config.migratedBy = context.plugin.name;
			return config;
		});
		context.hooks.role.attach(context.plugin.name, role => role);
	}`,
	"migration_throwing.js": "export default function() { throw new Error(\"load failed\"); }",
});
const { Base } = await import(pathToFileURL(path.join(dir, "base.js")).href);

// Logger recording warn and info messages, child() returns itself with the fields recorded
function recordingLogger() {
	const logger = {
		warnings: [] as string[],
		infos: [] as string[],
		children: [] as object[],
		warn(msg: string) { logger.warnings.push(msg); },
		info(msg: string) { logger.infos.push(msg); },
		child(fields: object) { logger.children.push(fields); return logger; },
	};
	return logger;
}

type Info = lib.PluginDeclaration & Record<string, any>;
function info(name: string, entrypoint?: string, extra: Record<string, any> = {}): Info {
	return {
		name,
		title: name,
		packagePath: path.join(dir, "package.json"),
		controllerEntrypoint: entrypoint,
		...extra,
	} as Info;
}

function setup(t1: any) {
	const logger = recordingLogger();
	const record: Record<string, any> = {};
	function load(pluginInfos: Info[], options: Partial<lib.PluginLoadOptions<object, Info>> = {}) {
		return lib.PluginLoader.load<object, Info>({
			type: "controller",
			context: { record },
			logger: logger as any,
			installed: pluginInfos,
			load: pluginInfos,
			exportName: "Plugin",
			baseClass: Base,
			...options,
		});
	}
	async function loadOne(pluginInfo: Info) {
		const { loaded } = await load([pluginInfo]);
		return loaded.get(pluginInfo);
	}
	return { logger, record, load, loadOne };
}

function pluginError(name: string, message: string) {
	return { name: "PluginError", message: `PluginError: ${message}`, pluginName: name };
}

t.test("PluginLoader", async t1 => {
	t1.test("load()", async t2 => {
		t2.test("loads plugins without the entrypoint as undefined", async t3 => {
			const { load, logger, record } = setup(t3);
			const pluginInfo = info("test");
			const { loaded, failed } = await load([pluginInfo]);
			t3.strictSame([...loaded], [[pluginInfo, undefined]]);
			t3.equal(failed.size, 0);
			t3.equal(record.loadedWith, undefined);
			t3.strictSame(logger.infos, []);
		});
		t2.test("loads nothing for an empty list", async t3 => {
			const { load } = setup(t3);
			const { loaded, failed } = await load([]);
			t3.equal(loaded.size, 0);
			t3.equal(failed.size, 0);
		});
		t2.test("calls the default export with the load context", async t3 => {
			const { loadOne, logger, record } = setup(t3);
			const pluginInfo = info("test", "function.js");
			t3.strictSame(await loadOne(pluginInfo), { api: true });
			t3.equal(record.loadedWith.record, record);
			t3.equal(record.loadedWith.plugin, pluginInfo);
			t3.equal(record.loadedWith.logger, logger);
			t3.strictSame(logger.children, [{ plugin: "test" }]);
			t3.equal(typeof record.loadedWith.plugins.waitFor, "function");
			t3.equal(typeof record.loadedWith.plugins.checkInstalled, "function");
			t3.equal(typeof record.loadedWith.plugins.checkEnabled, "function");
			t3.strictSame(logger.warnings, []);
			t3.match(logger.infos, [/^Loaded plugin test in \d+ms$/]);
		});
		t2.test("returns what a synchronous default export returns", async t3 => {
			const { loadOne } = setup(t3);
			t3.equal(await loadOne(info("test", "sync_function.js")), 42);
		});
		t2.test("builds the context per plugin when given a function", async t3 => {
			const { load, record } = setup(t3);
			const seen: string[] = [];
			await load([info("a", "function.js"), info("b")], {
				context: (p: Info) => { seen.push(p.name); return { record, name: p.name }; },
			});
			t3.equal(record.loadedWith.name, "a");
			t3.strictSame(seen, ["a"], "not built for plugins without the entrypoint");
		});
		t2.test("loads the entrypoint for the given type", async t3 => {
			const { load, record, logger } = setup(t3);
			const pluginInfo = info("test", undefined, { hostEntrypoint: "function.js" });
			const { loaded } = await load([pluginInfo], { type: "host" });
			t3.strictSame(loaded.get(pluginInfo), { api: true });
			t3.equal(record.loadedWith.plugin, pluginInfo);
			t3.match(logger.infos, [/^Loaded plugin test in \d+ms$/]);
		});
		t2.test("does not log loading migrations", async t3 => {
			const { load, logger } = setup(t3);
			const pluginInfo = info("test", undefined, { migrationEntrypoint: "function.js" });
			const { loaded } = await load([pluginInfo], { type: "migration" });
			t3.strictSame(loaded.get(pluginInfo), { api: true });
			t3.strictSame(logger.infos, []);
		});
		t2.test("loads a deprecated class export", async t3 => {
			const { loadOne, record, logger } = setup(t3);
			const pluginInfo = info("test", "class.js");
			const plugin = await loadOne(pluginInfo) as any;
			t3.equal(plugin, record.loadedWith);
			t3.ok(plugin instanceof Base);
			t3.equal(plugin.context.plugin, pluginInfo);
			t3.equal(plugin.detached, false);
			t3.strictSame(logger.warnings, ["Plugin test is using deprecated class export"]);
		});
		t2.test("does not accept class exports without exportName", async t3 => {
			const { load } = setup(t3);
			await t3.rejects(
				load([info("test", "class.js")], { exportName: undefined }),
				pluginError("test", "Expected controller plugin test to export a default function"),
			);
		});
		t2.test("does not accept class exports without baseClass", async t3 => {
			const { load } = setup(t3);
			await t3.rejects(
				load([info("test", "class.js")], { baseClass: undefined }),
				pluginError("test", "Plugin test must export either a default function or Plugin class"),
			);
		});
		t2.test("detaches hooks if init throws", async t3 => {
			const { loadOne, record } = setup(t3);
			await t3.rejects(loadOne(info("test", "throwing_class.js")), pluginError("test", "init failed"));
			t3.equal(record.detached.detached, true);
		});
		t2.test("throws if neither a function nor a class is exported", async t3 => {
			const { loadOne } = setup(t3);
			for (const entrypoint of ["empty.js", "default_object.js"]) {
				await t3.rejects(
					loadOne(info("test", entrypoint)),
					pluginError("test", "Plugin test must export either a default function or Plugin class"),
					entrypoint,
				);
			}
		});
		t2.test("throws if the class does not extend the base class", async t3 => {
			const { loadOne } = setup(t3);
			await t3.rejects(
				loadOne(info("test", "wrong_parent.js")),
				pluginError("test", "Expected Plugin exported from test to extend Base"),
			);
		});
		t2.test("throws if the class export is not a class", async t3 => {
			const { loadOne } = setup(t3);
			await t3.rejects(
				loadOne(info("test", "not_class.js")),
				pluginError("test", "Expected plugin test to export a class named Plugin"),
			);
		});
		t2.test("wraps import errors", async t3 => {
			const { loadOne } = setup(t3);
			const err: any = await loadOne(info("test", "syntax_error.js")).catch(e => e);
			t3.ok(err instanceof lib.PluginError);
			t3.equal(err.pluginName, "test");
			t3.equal(err.original.name, "SyntaxError");
			const missing: any = await loadOne(info("test", "missing.js")).catch(e => e);
			t3.ok(missing instanceof lib.PluginError);
			t3.equal(missing.original.code, "ERR_MODULE_NOT_FOUND");
		});
		t2.test("does not wrap installation errors", async t3 => {
			const { loadOne } = setup(t3);
			await t3.rejects(
				loadOne(info("test", "installation_error.js")),
				new lib.InstallationError("missing dependency"),
			);
		});
		t2.test("finishes loading the rest before throwing the first error in list order", async t3 => {
			const { load, record } = setup(t3);
			const ok = info("ok", "function.js");
			await t3.rejects(
				load([info("a", "throwing.js", { delay: 10 }), info("b", "throwing.js"), ok]),
				pluginError("a", "a failed"),
			);
			t3.equal(record.loadedWith.plugin, ok);
		});
		t2.test("returns failures with continueOnError", async t3 => {
			const { load } = setup(t3);
			const a = info("a", "throwing.js");
			const ok = info("ok", "function.js");
			const none = info("none");
			const { loaded, failed } = await load([a, ok, none], { continueOnError: true });
			t3.strictSame([...loaded.keys()], [ok, none]);
			t3.strictSame([...failed.keys()], [a]);
			t3.ok(failed.get(a) instanceof lib.PluginError);
		});
	});

	t1.test("plugins.waitFor()", async t2 => {
		t2.test("resolves to what a plugin later in the list returned", async t3 => {
			const { load, logger } = setup(t3);
			const { loaded } = await load([info("a", "waiting.js", { waitFor: "b" }), info("b", "waiting.js")]);
			const b = { name: "b", got: undefined };
			t3.strictSame([...loaded.values()], [{ name: "a", got: b }, b]);
			t3.strictSame(logger.warnings, []);
		});
		t2.test("resolves every waiter for the same plugin", async t3 => {
			const { load } = setup(t3);
			const { loaded } = await load([
				info("a", "waiting.js", { waitFor: "c" }),
				info("b", "waiting.js", { waitFor: "c" }),
				info("c", "waiting.js"),
			]);
			const c = { name: "c", got: undefined };
			t3.strictSame([...loaded.values()], [{ name: "a", got: c }, { name: "b", got: c }, c]);
		});
		t2.test("resolves to undefined for a plugin without the entrypoint", async t3 => {
			const { load, logger } = setup(t3);
			const { loaded } = await load([info("a", "waiting.js", { waitFor: "b" }), info("b")]);
			t3.strictSame([...loaded.values()], [{ name: "a", got: undefined }, undefined]);
			t3.strictSame(logger.warnings, [], "a plugin without the entrypoint counts as loaded");
		});
		t2.test("resolves after loading finished", async t3 => {
			const { load, record, logger } = setup(t3);
			await load([info("test", "function.js"), info("b", "waiting.js")]);
			const { plugins } = record.loadedWith;
			t3.strictSame(await plugins.waitFor("b"), { name: "b", got: undefined });
			t3.equal(await plugins.waitFor("missing"), undefined);
			t3.strictSame(logger.warnings, ["Plugin test waited for plugin missing which is not loaded"]);
		});
		t2.test("resolves undefined with a warning for a plugin not in the load list", async t3 => {
			const { load, logger } = setup(t3);
			const installed = [info("off", "function.js")];
			const waiting = info("a", "waiting.js", { waitFor: "off", timeoutMs: 60_000 });
			const { loaded } = await load([waiting], { installed });
			t3.strictSame(loaded.get(waiting), { name: "a", got: undefined });
			t3.strictSame(logger.warnings, ["Plugin a waited for plugin off which is not loaded"]);
		});
		t2.test("resolves undefined with a warning if the plugin failed", async t3 => {
			const { load, logger } = setup(t3);
			const waiting = info("a", "waiting.js", { waitFor: "b", timeoutMs: 60_000 });
			const { loaded } = await load([waiting, info("b", "throwing.js")], { continueOnError: true });
			t3.strictSame(loaded.get(waiting), { name: "a", got: undefined });
			t3.strictSame(logger.warnings, ["Plugin a waited for plugin b which is not loaded"]);
		});
		t2.test("breaks a wait cycle with the timeout", async t3 => {
			const { load, logger } = setup(t3);
			const { loaded } = await load([
				info("a", "waiting.js", { waitFor: "b", timeoutMs: 10 }),
				info("b", "waiting.js", { waitFor: "a", timeoutMs: 60_000 }),
			]);
			const a = { name: "a", got: undefined };
			t3.strictSame([...loaded.values()], [a, { name: "b", got: a }]);
			t3.strictSame(logger.warnings, ["Plugin a timed out after 10ms waiting for plugin b"]);
		});
		t2.test("keeps other waiters when one times out", async t3 => {
			const { load, logger } = setup(t3);
			const { loaded } = await load([
				info("a", "waiting.js", { waitFor: "c", timeoutMs: 5 }),
				info("b", "waiting.js", { waitFor: "c", timeoutMs: 60_000 }),
				info("c", "throwing.js", { delay: 30 }),
			], { continueOnError: true });
			t3.strictSame([...loaded.values()], [{ name: "a", got: undefined }, { name: "b", got: undefined }]);
			t3.strictSame(logger.warnings, [
				"Plugin a timed out after 5ms waiting for plugin c",
				"Plugin b waited for plugin c which is not loaded",
			]);
		});
		t2.test("defaults to a 30 second timeout", async t3 => {
			const { load } = setup(t3);
			const delays: number[] = [];
			const setTimeout = globalThis.setTimeout;
			t3.intercept(globalThis, "setTimeout", {
				value: (fn: () => void, ms: number) => { delays.push(ms); return setTimeout(fn, ms); },
			});
			await load([info("a", "waiting.js", { waitFor: "b" }), info("b", "waiting.js")]);
			t3.ok(delays.includes(30_000), String(delays));
		});
	});

	t1.test("plugins.checkInstalled()", async t2 => {
		t2.test("checks the installed list", async t3 => {
			const { load, record } = setup(t3);
			const pluginInfo = info("test", "function.js");
			await load([pluginInfo], { installed: [pluginInfo, info("off")] });
			const { plugins } = record.loadedWith;
			t3.equal(plugins.checkInstalled("test"), true);
			t3.equal(plugins.checkInstalled("off"), true);
			t3.equal(plugins.checkInstalled("missing"), false);
		});
	});

	t1.test("plugins.checkEnabled()", async t2 => {
		t2.test("checks the load list", async t3 => {
			const { load, record } = setup(t3);
			const pluginInfo = info("test", "function.js");
			await load([pluginInfo], { installed: [pluginInfo, info("off")] });
			const { plugins } = record.loadedWith;
			t3.equal(plugins.checkEnabled("test"), true);
			t3.equal(plugins.checkEnabled("off"), false);
			t3.equal(plugins.checkEnabled("missing"), false);
		});
	});
});

t.test("loadPluginMigrations()", async t1 => {
	function migrationInfo(entrypoint?: string, name = "test", version = "1.0.0") {
		return {
			name,
			title: name,
			version,
			packagePath: path.join(dir, "package.json"),
			migrationEntrypoint: entrypoint,
		} as lib.PluginNodeEnvInfo;
	}
	function cleanUp(t2: any) {
		t2.teardown(() => {
			lib.ControllerConfig.pluginMigrations.clear();
			lib.Role.pluginMigrations.clear();
			lib.Config.pluginVersions.clear();
		});
	}

	t1.test("attaches migrations from the migration entrypoint", async t2 => {
		cleanUp(t2);
		await lib.loadPluginMigrations([migrationInfo("migrations.js"), migrationInfo(undefined, "other")]);
		t2.strictSame([...lib.ControllerConfig.pluginMigrations.attached], ["test"]);
		t2.strictSame([...lib.Role.pluginMigrations.attached], ["test"]);
		t2.strictSame([...lib.HostConfig.pluginMigrations.attached], []);
		t2.strictSame(lib.ControllerConfig.pluginMigrations.reduce({} as any), { migratedBy: "test" });
	});
	t1.test("registers the version of every plugin", async t2 => {
		cleanUp(t2);
		await lib.loadPluginMigrations([migrationInfo("migrations.js"), migrationInfo(undefined, "other", "2.0.0")]);
		t2.strictSame([...lib.Config.pluginVersions], [["test", "1.0.0"], ["other", "2.0.0"]]);
	});
	t1.test("rejects with a PluginError if the entrypoint throws", async t2 => {
		cleanUp(t2);
		await t2.rejects(
			lib.loadPluginMigrations([migrationInfo("migration_throwing.js")]),
			pluginError("test", "load failed"),
		);
		t2.strictSame([...lib.Config.pluginVersions], [["test", "1.0.0"]], "versions are set before loading");
	});
});
