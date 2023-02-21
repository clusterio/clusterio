"use strict";
const assert = require("assert").strict;

const mock = require("../mock");
const libLink = require("@clusterio/lib/link");
const libPlugin = require("@clusterio/lib/plugin");


describe("lib/plugin", function() {
	describe("class BaseInstancePlugin", function() {
		let instancePlugin;
		it("should be constructible", async function() {
			instancePlugin = new libPlugin.BaseInstancePlugin({}, new mock.MockInstance(), {});
			await instancePlugin.init();
		});
		it("should define defaults for hooks", async function() {
			await instancePlugin.onMetrics();
			await instancePlugin.onStart();
			await instancePlugin.onStop();
			instancePlugin.onExit();
			await instancePlugin.onOutput({});
			instancePlugin.onControllerConnectionEvent("connect");
			await instancePlugin.onPrepareControllerDisconnect();
		});
		describe("sendRcon", function() {
			it("should send commands out of order", async function() {
				instancePlugin.instance.server.rconCommandResults.set("a", { time: 100, response: "a" });
				instancePlugin.instance.server.rconCommandResults.set("b", { time: 50, response: "b" });

				let a = instancePlugin.sendRcon("a");
				let b = instancePlugin.sendRcon("b");
				let result = await Promise.race([a, b]);
				assert.equal(result, "b");
			});
			it("should propagate errors", async function() {
				instancePlugin.instance.server.rconCommandResults.set("a", new Error("ref"));
				await assert.rejects(instancePlugin.sendRcon("a"), new Error("ref"));
			});
		});
		describe("sendOrderedRcon", function() {
			it("should send commands in order", async function() {
				instancePlugin.instance.server.rconCommandResults.set("a", { time: 100, response: "a" });
				instancePlugin.instance.server.rconCommandResults.set("b", { time: 50, response: "b" });

				let a = instancePlugin.sendOrderedRcon("a");
				let b = instancePlugin.sendOrderedRcon("b");
				let result = await Promise.race([a, b]);
				assert.equal(result, "a");
			});
			it("should propagate errors", async function() {
				instancePlugin.instance.server.rconCommandResults.set("a", new Error("ref"));
				await assert.rejects(instancePlugin.sendOrderedRcon("a"), new Error("ref"));
			});
		});
	});

	describe("class BaseControllerPlugin", function() {
		let controllerPlugin;
		it("should be constructible", async function() {
			controllerPlugin = new libPlugin.BaseControllerPlugin({}, {}, {}, new mock.MockLogger());
			await controllerPlugin.init();
		});
		it("should define defaults for hooks", async function() {
			await controllerPlugin.onInstanceStatusChanged({}, "running", "initialized");
			await controllerPlugin.onControllerConfigFieldChanged({}, "foo", null);
			await controllerPlugin.onInstanceConfigFieldChanged({}, {}, "foo", null);
			await controllerPlugin.onMetrics();
			await controllerPlugin.onShutdown();
			controllerPlugin.onSlaveConnectionEvent({}, "connect");
			await controllerPlugin.onPrepareSlaveDisconnect({});
		});
	});

	describe("attachPluginMessages()", function() {
		let mockLink = new libLink.Link("source", "target", new mock.MockConnector());
		let mockEvent = new libLink.Event({ type: "test:test", links: ["target-source"] });
		it("should accept pluginInfo without messages", function() {
			libPlugin.attachPluginMessages(mockLink, { info: {} });
		});
		it("should attach handler for the given message", function() {
			function mockEventEventHandler() { };
			libPlugin.attachPluginMessages(
				mockLink, { mockEventEventHandler, info: { name: "test", messages: { mockEvent }}}
			);
			assert(mockLink._handlers.get("test:test_event"), "handler was not registered");
		});
		it("should throw if missing handler for the given message", function() {
			assert.throws(
				() => libPlugin.attachPluginMessages(mockLink, { info: { name: "test", messages: { mockEvent }}}),
				new Error("Missing mockEventEventHandler on plugin test for test:test_event on source-target link")
			);
		});
		it("should throw if message starts with the wrong prefix", function() {
			assert.throws(
				() => libPlugin.attachPluginMessages(mockLink, { info: { name: "foo", messages: { mockEvent }}}),
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
				logger: new mock.MockLogger(),
			}],
			["beta", {
				test: async function() { betaTestCalled = true; },
				pass: async function() { },
				error: async function() { },
				logger: new mock.MockLogger(),
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
