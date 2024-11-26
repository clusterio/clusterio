"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const lib = require("@clusterio/lib");
const { BaseControllerPlugin } = require("@clusterio/controller");
const { escapeRegExp } = lib;


describe("lib/plugin_loader", function() {
	describe("loadPluginInfos()", function() {
		let baseDir = path.join("temp", "test", "plugin");
		let missingPlugin = path.join(baseDir, "missing_plugin");
		let testPlugin = path.join(baseDir, "test_plugin");
		let brokenPlugin = path.join(baseDir, "broken_plugin");
		let invalidPlugin = path.join(baseDir, "invalid_plugin");
		before(async function() {
			async function writePlugin(pluginPath, infoName) {
				await fs.outputFile(
					path.join(pluginPath, "index.js"),
					`module.exports.plugin = { name: "${infoName}" };`
				);
				await fs.outputFile(
					path.join(pluginPath, "package.json"),
					'{ "version": "0.0.1" }'
				);
			}

			await writePlugin(testPlugin, "test");
			await writePlugin(brokenPlugin, "broken");
			await fs.outputFile(path.join(brokenPlugin, "index.js"), "Syntax Error");
			await writePlugin(invalidPlugin, "wrong");
		});

		it("should throw on missing plugin", async function() {
			await assert.rejects(
				lib.loadPluginInfos(new Map([["missing", missingPlugin]]), []),
				new RegExp(`^Error: PluginError: Cannot find module '${escapeRegExp(missingPlugin)}'`)
			);
		});
		it("should load test plugin", async function() {
			assert.deepEqual(
				await lib.loadPluginInfos(new Map([["test", path.resolve(testPlugin)]])),
				[{ name: "test", version: "0.0.1", npmPackage: undefined, requirePath: path.resolve(testPlugin) }]
			);
		});
		it("should reject on broken plugin", async function() {
			let brokenMessage;
			try {
				// eslint-disable-next-line node/global-require
				require(path.resolve(brokenPlugin));
			} catch (err) {
				brokenMessage = err.message;
			}
			await assert.rejects(
				lib.loadPluginInfos(new Map([["broken", path.resolve(brokenPlugin)]])),
				{ message: `PluginError: ${brokenMessage}` }
			);
		});
		it("should reject on invalid plugin", async function() {
			await assert.rejects(
				lib.loadPluginInfos(new Map([["invalid", path.resolve(invalidPlugin)]])),
				{ message: `Expected plugin at ${path.resolve(invalidPlugin)} to be named invalid but got wrong` }
			);
		});
	});
	describe("loadPluginClass()", function() {
		let baseDir = path.join("temp", "test", "plugin");
		let missingClass = path.join(baseDir, "missing_class_plugin");
		let wrongParentClass = path.join(baseDir, "wrong_parent_class_plugin");
		before(async function() {
			async function writeEntrypoint(pluginPath, content) {
				await fs.outputFile(path.join(pluginPath, "controller.js"), content);
			}

			await writeEntrypoint(missingClass, "");
			await writeEntrypoint(
				wrongParentClass, "class ControllerPlugin {}\n module.exports = { ControllerPlugin };\n"
			);
		});
		it("should throw if class is missing from entrypoint", async function() {
			const requirePath = path.resolve(missingClass);
			await assert.rejects(
				lib.loadPluginClass(
					"test",
					path.posix.join(requirePath, "controller"),
					"ControllerPlugin",
					BaseControllerPlugin,
				),
				{
					message:
						`PluginError: Expected ${path.posix.join(requirePath, "controller")} ` +
						"to export a class named ControllerPlugin",
				}
			);
		});
		it("should throw if class is not a subclass of BaseControllerPlugin", async function() {
			const requirePath = path.resolve(wrongParentClass);
			await assert.rejects(
				lib.loadPluginClass(
					"test",
					path.posix.join(requirePath, "controller"),
					"ControllerPlugin",
					BaseControllerPlugin,
				),
				{
					message:
						"PluginError: Expected ControllerPlugin exported from " +
						`${path.posix.join(requirePath, "controller")} to be a subclass of BaseControllerPlugin`,
				}
			);
		});
	});
	describe("loadPluginList()", async function() {
		const old_cwd = process.cwd();
		const baseDir = path.join("temp", "test", "plugin_list");
		const pluginListPath = path.join(baseDir, "plugin_list.json");
		const localPluginPath = path.join(baseDir, "plugins", "local_plugin");
		const localPluginPathAbs = path.resolve(localPluginPath);
		const externalPluginPath = path.join(baseDir, "external_plugins", "external_plugin");
		const externalPluginPathAbs = path.resolve(externalPluginPath);
		const npmPluginPath = path.join(baseDir, "node_modules", "npm-plugin");
		let pluginList;

		before(async function() {
			// Setup test plugins
			async function writePlugin(pluginPath, name) {
				await fs.outputFile(
					path.join(pluginPath, "index.js"),
					`module.exports.plugin = { name: "${name}" };`
				);
				await fs.outputFile(
					path.join(pluginPath, "package.json"),
					JSON.stringify({
						name: path.basename(pluginPath),
						version: "0.0.1",
						keywords: ["clusterio-plugin"]
					})
				);
			}

			// Create local plugin
			await writePlugin(localPluginPath, "local_plugin");
			// Create external plugin
			await writePlugin(externalPluginPath, "external_plugin");
			// Create npm plugin
			await writePlugin(npmPluginPath, "npm");
			// Create root package.json
			await fs.outputFile(
				path.join(baseDir, "package.json"),
				JSON.stringify({
					dependencies: {
						"npm-plugin": "^1.0.0"
					}
				})
			);

			process.chdir(baseDir);
			pluginList = await lib.loadPluginList(pluginListPath, true);
		});
		beforeEach(async function() {
			await fs.remove(pluginListPath);
		});

		it("should discover local plugins", async function() {
			assert.ok(pluginList.has("local_plugin"));
			assert.ok(pluginList.has("external_plugin"));
			assert.strictEqual(pluginList.get("local_plugin"), localPluginPathAbs);
			assert.strictEqual(pluginList.get("external_plugin"), externalPluginPathAbs);
		});

		it("should discover npm plugins", async function() {
			assert.ok(pluginList.has("npm"));
			assert.strictEqual(pluginList.get("npm"), "npm-plugin");
		});

		it("should load existing plugin list", async function() {
			const existingList = new Map([["test", "/test/path"]]);
			await fs.outputFile(pluginListPath, JSON.stringify([...existingList]));
			const pluginList = await lib.loadPluginList(pluginListPath, false);
			assert.ok(pluginList.has("test"));
			assert.strictEqual(pluginList.get("test"), "/test/path");
		});

		after(async function() {
			process.chdir(old_cwd);
			console.log(baseDir, process.cwd());
			await fs.remove(baseDir);
		});
	});
});
