"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const libPluginLoader = require("@clusterio/lib/plugin_loader");


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
					path.join(pluginPath, "info.js"),
					`module.exports = { name: "${infoName}" };`
				);
				await fs.outputFile(
					path.join(pluginPath, "package.json"),
					'{ "version": "0.0.1" }'
				);
			}

			await writePlugin(testPlugin, "test");
			await writePlugin(brokenPlugin, "broken");
			await fs.outputFile(path.join(brokenPlugin, "info.js"), "Syntax Error");
			await writePlugin(invalidPlugin, "wrong");
		});

		it("should throw on missing plugin", async function() {
			await assert.rejects(
				libPluginLoader.loadPluginInfos(new Map([["missing", missingPlugin]]), []),
				new RegExp(`^Error: PluginError: Cannot find module '${missingPlugin}/info'`)
			);
		});
		it("should load test plugin", async function() {
			assert.deepEqual(
				await libPluginLoader.loadPluginInfos(new Map([["test", path.resolve(testPlugin)]])),
				[{ name: "test", version: "0.0.1", requirePath: path.resolve(testPlugin) }]
			);
		});
		it("should reject on broken plugin", async function() {
			await assert.rejects(
				libPluginLoader.loadPluginInfos(new Map([["broken", path.resolve(brokenPlugin)]])),
				{ message: "PluginError: Unexpected identifier" }
			);
		});
		it("should reject on invalid plugin", async function() {
			await assert.rejects(
				libPluginLoader.loadPluginInfos(new Map([["invalid", path.resolve(invalidPlugin)]])),
				{ message: `Expected plugin at ${path.resolve(invalidPlugin)} to be named invalid but got wrong` }
			);
		});
	});
});
