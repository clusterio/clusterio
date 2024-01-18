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
});
