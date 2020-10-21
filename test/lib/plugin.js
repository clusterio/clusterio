"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const mock = require("../mock");
const libLink = require("@clusterio/lib/link");
const libPlugin = require("@clusterio/lib/plugin");


describe("lib/plugin", function() {
	describe("class BaseInstancePlugin", function() {
		let instancePlugin;
		it("should be constructible", async function() {
			instancePlugin = new libPlugin.BaseInstancePlugin();
			await instancePlugin.init();
		});
		it("should define defaults for hooks", async function() {
			await instancePlugin.onMetrics();
			await instancePlugin.onStart();
			await instancePlugin.onStop();
			instancePlugin.onExit();
			await instancePlugin.onOutput({});
			instancePlugin.onMasterConnectionEvent("connect");
			await instancePlugin.onPrepareMasterDisconnect();
		});
	});

	describe("class BaseMasterPlugin", function() {
		let masterPlugin;
		it("should be constructible", async function() {
			masterPlugin = new libPlugin.BaseMasterPlugin();
			await masterPlugin.init();
		});
		it("should define defaults for hooks", async function() {
			await masterPlugin.onInstanceStatusChanged({}, "running", "initialized");
			await masterPlugin.onMetrics();
			await masterPlugin.onShutdown();
			masterPlugin.onSlaveConnectionEvent({}, "connect");
			await masterPlugin.onPrepareSlaveDisconnect({});
		});
	});

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
				libPlugin.loadPluginInfos(new Map([["missing", missingPlugin]]), []),
				new RegExp(`^Error: PluginError: Cannot find module '${missingPlugin}/info'`)
			);
		});
		it("should load test plugin", async function() {
			assert.deepEqual(
				await libPlugin.loadPluginInfos(new Map([["test", path.resolve(testPlugin)]])),
				[{ name: "test", version: "0.0.1", requirePath: path.resolve(testPlugin) }]
			);
		});
		it("should reject on broken plugin", async function() {
			await assert.rejects(
				libPlugin.loadPluginInfos(new Map([["broken", path.resolve(brokenPlugin)]])),
				{ message: "PluginError: Unexpected identifier" }
			);
		});
		it("should reject on invalid plugin", async function() {
			await assert.rejects(
				libPlugin.loadPluginInfos(new Map([["invalid", path.resolve(invalidPlugin)]])),
				{ message: `Expected plugin at ${path.resolve(invalidPlugin)} to be named invalid but got wrong` }
			);
		});
	});

	describe("attachPluginMessages()", function() {
		let mockLink = new libLink.Link("source", "target", new mock.MockConnector());
		let mockEvent = new libLink.Event({ type: "test:test", links: ["target-source"] });
		it("should accept pluginInfo without messages", function() {
			libPlugin.attachPluginMessages(mockLink, {}, null);
		});
		it("should attach handler for the given message", function() {
			function mockEventEventHandler() { };
			libPlugin.attachPluginMessages(
				mockLink, { name: "test", messages: { mockEvent }}, { mockEventEventHandler }
			);
			assert(mockLink._handlers.get("test:test_event"), "handler was not registered");
		});
		it("should throw if missing handler for the given message", function() {
			assert.throws(
				() => libPlugin.attachPluginMessages(mockLink, { name: "test", messages: { mockEvent }}, {}),
				new Error("Missing handler for test:test_event on source-target link")
			);
		});
		it("should throw if message starts with the wrong prefix", function() {
			assert.throws(
				() => libPlugin.attachPluginMessages(mockLink, { name: "foo", messages: { mockEvent }}, {}),
				new Error('Type of mockEvent message must start with "foo:"')
			);
		});
	});

	describe("invokeHook()", function() {
		let betaTestCalled = false;
		let plugins = new Map([
			["alpha", {
				test: async function() { },
				pass: async function(arg) { return arg; },
				error: async function() { throw new Error("Test"); },
			}],
			["beta", {
				test: async function() { betaTestCalled = true; },
				pass: async function() { },
				error: async function() { },
			}],
		]);
		it("should invoke the hook on the plugin", async function() {
			await libPlugin.invokeHook(plugins, "test");
			assert(betaTestCalled, "Hook was not called");
		});
		it("should pass and return args", async function() {
			let result = await libPlugin.invokeHook(plugins, "pass", 1234);
			assert.deepEqual(result, [1234]);
		});
		it("should ignore errors", async function() {
			await libPlugin.invokeHook(plugins, "error");
		});
	});
});
