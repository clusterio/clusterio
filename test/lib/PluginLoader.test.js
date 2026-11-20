import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import * as mock from "../mock.js";
import * as lib from "@clusterio/lib";
import { BaseControllerPlugin } from "@clusterio/controller";

describe("lib/PluginLoader", function() {
	let dir;
	let logger;
	let controller;
	before(async function() {
		// Inside the repo so the class entrypoints can import @clusterio/controller
		dir = path.resolve("temp", "test", "plugin_loader");
		await fs.mkdir(dir, { recursive: true });
		const entrypoints = {
			"function.js": `export default async function(context) {
				context.controller.loadedWith = context;
				return { api: true };
			}`,
			"class.js": `import { BaseControllerPlugin } from "@clusterio/controller";
				export class ControllerPlugin extends BaseControllerPlugin {
					async init() { this.controller.loadedWith = this; }
					async onSaveData() { }
				}`,
			"throwing_class.js": `import { BaseControllerPlugin } from "@clusterio/controller";
				export class ControllerPlugin extends BaseControllerPlugin {
					async init() { throw new Error("init failed"); }
					async onSaveData() { }
				}`,
			"empty.js": "",
			"wrong_parent.js": "export class ControllerPlugin {};\n",
			"throwing.js": `export default async function({ plugin }) {
				await new Promise(resolve => setTimeout(resolve, plugin.delay ?? 0));
				throw new Error(\`\${plugin.name} failed\`);
			}`,
			// Waits for the plugin named in plugin.waitFor and returns what it got
			"waiting.js": `export default async function({ plugin, plugins }) {
				const got = plugin.waitFor ? await plugins.waitFor(plugin.waitFor, plugin.timeoutMs) : undefined;
				return { name: plugin.name, got };
			}`,
		};
		for (const [file, content] of Object.entries(entrypoints)) {
			await fs.writeFile(path.join(dir, file), content);
		}
	});
	after(async function() {
		await fs.rm(dir, { recursive: true, force: true });
	});
	beforeEach(function() {
		controller = new mock.MockController();
		logger = new mock.MockLogger();
		logger.warnings = [];
		logger.warn = msg => logger.warnings.push(msg);
	});

	function info(name, entrypoint, extra = {}) {
		return { name, packagePath: path.join(dir, "package.json"), controllerEntrypoint: entrypoint, ...extra };
	}
	function load(pluginInfos, options = {}) {
		return lib.PluginLoader.load({
			type: "controller",
			context: { controller },
			logger,
			installed: pluginInfos,
			load: pluginInfos,
			exportName: "ControllerPlugin",
			baseClass: BaseControllerPlugin,
			...options,
		});
	}
	async function loadOne(pluginInfo) {
		const { loaded } = await load([pluginInfo]);
		return loaded.get(pluginInfo);
	}

	describe("loading", function() {
		it("should load plugins without the entrypoint as undefined", async function() {
			const pluginInfo = { name: "test" };
			const { loaded } = await load([pluginInfo]);
			assert.deepEqual([...loaded], [[pluginInfo, undefined]]);
			assert.equal(controller.loadedWith, undefined);
		});
		it("should call the default export with the load context", async function() {
			const pluginInfo = info("test", "function.js");
			assert.deepEqual(await loadOne(pluginInfo), { api: true });
			assert.equal(controller.loadedWith.controller, controller);
			assert.equal(controller.loadedWith.plugin, pluginInfo);
			assert.equal(controller.loadedWith.logger, logger);
			assert.equal(typeof controller.loadedWith.plugins.waitFor, "function");
			assert.deepEqual(logger.warnings, []);
		});
		it("should build the context per plugin when given a function", async function() {
			const pluginInfo = info("test", "function.js");
			await load([pluginInfo], { context: p => ({ controller, name: p.name }) });
			assert.equal(controller.loadedWith.name, "test");
		});
		it("should load a deprecated class export", async function() {
			const pluginInfo = info("test", "class.js");
			assert.equal(await loadOne(pluginInfo), controller.loadedWith);
			assert(controller.loadedWith instanceof BaseControllerPlugin);
			assert.equal(controller.loadedWith.info, pluginInfo);
			assert.deepEqual([...controller.hooks.save.attached], ["test"]);
			assert.deepEqual(logger.warnings, ["Plugin test is using deprecated class export"]);
		});
		it("should not accept class exports without exportName", async function() {
			await assert.rejects(
				load([info("test", "class.js")], { exportName: undefined }),
				{ message: "PluginError: Expected controller plugin test to export a default function" },
			);
		});
		it("should detach hooks if init throws", async function() {
			await assert.rejects(
				loadOne(info("test", "throwing_class.js")),
				err => err instanceof lib.PluginError && err.original.message === "init failed",
			);
			assert.equal(controller.hooks.size, 0);
		});
		it("should throw if neither a function nor a class is exported", async function() {
			await assert.rejects(
				loadOne(info("test", "empty.js")),
				{ message: "PluginError: Plugin test must export either a default function or ControllerPlugin class" },
			);
		});
		it("should throw if the class is not a subclass of the base class", async function() {
			await assert.rejects(
				loadOne(info("test", "wrong_parent.js")),
				{ message: "PluginError: Expected ControllerPlugin exported from test to extend BaseControllerPlugin" },
			);
		});
		it("should finish loading the rest before throwing the first error in list order", async function() {
			const ok = info("ok", "function.js");
			await assert.rejects(
				load([info("a", "throwing.js", { delay: 10 }), info("b", "throwing.js"), ok]),
				err => err instanceof lib.PluginError && err.pluginName === "a",
			);
			assert.equal(controller.loadedWith.plugin, ok);
		});
		it("should return failures with continueOnError", async function() {
			const a = info("a", "throwing.js");
			const ok = info("ok", "function.js");
			const { loaded, failed } = await load([a, ok], { continueOnError: true });
			assert.deepEqual([...loaded.keys()], [ok]);
			assert.deepEqual([...failed.keys()], [a]);
			assert(failed.get(a) instanceof lib.PluginError);
		});
	});

	describe("plugins.waitFor()", function() {
		it("should resolve to what a plugin later in the list returned", async function() {
			const { loaded } = await load([info("a", "waiting.js", { waitFor: "b" }), info("b", "waiting.js")]);
			const b = { name: "b", got: undefined };
			assert.deepEqual([...loaded.values()], [{ name: "a", got: b }, b]);
			assert.deepEqual(logger.warnings, []);
		});
		it("should resolve after loading finished", async function() {
			const pluginInfo = info("test", "function.js");
			await load([pluginInfo, info("b", "waiting.js")]);
			const { plugins } = controller.loadedWith;
			assert.deepEqual(await plugins.waitFor("b"), { name: "b", got: undefined });
			assert.equal(await plugins.waitFor("missing"), undefined);
			assert.deepEqual(logger.warnings, ["Plugin test waited for plugin missing which is not loaded"]);
		});
		it("should resolve undefined with a warning once loading finishes without the plugin", async function() {
			const installed = [info("off", "function.js")];
			const waiting = info("a", "waiting.js", { waitFor: "off", timeoutMs: 60_000 });
			const { loaded } = await load([waiting], { installed });
			assert.deepEqual(loaded.get(waiting), { name: "a", got: undefined });
			assert.deepEqual(logger.warnings, ["Plugin a waited for plugin off which is not loaded"]);
		});
		it("should resolve undefined with a warning if the plugin failed", async function() {
			const waiting = info("a", "waiting.js", { waitFor: "b", timeoutMs: 60_000 });
			const { loaded } = await load([waiting, info("b", "throwing.js")], { continueOnError: true });
			assert.deepEqual(loaded.get(waiting), { name: "a", got: undefined });
			assert.deepEqual(logger.warnings, ["Plugin a waited for plugin b which is not loaded"]);
		});
		it("should break a wait cycle with the timeout", async function() {
			const { loaded } = await load([
				info("a", "waiting.js", { waitFor: "b", timeoutMs: 10 }),
				info("b", "waiting.js", { waitFor: "a", timeoutMs: 60_000 }),
			]);
			const a = { name: "a", got: undefined };
			assert.deepEqual([...loaded.values()], [a, { name: "b", got: a }]);
			assert.deepEqual(logger.warnings, ["Plugin a timed out after 10ms waiting for plugin b"]);
		});
	});

	describe("plugins.checkInstalled()", function() {
		it("should check the installed list", async function() {
			const pluginInfo = info("test", "function.js");
			await load([pluginInfo], { installed: [pluginInfo, { name: "off" }] });
			const { plugins } = controller.loadedWith;
			assert.equal(plugins.checkInstalled("test"), true);
			assert.equal(plugins.checkInstalled("off"), true);
			assert.equal(plugins.checkInstalled("missing"), false);
		});
	});
});
