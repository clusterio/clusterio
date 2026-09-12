import assert from "node:assert/strict";

import * as mock from "../mock.js";
import * as lib from "@clusterio/lib";


describe("lib/plugin", function() {
	describe("pluginNeedsWebBuild()", function() {
		it("should be false for plugins with only host, instance or ctl code", function() {
			assert.equal(lib.pluginNeedsWebBuild({ name: "foo", title: "Foo" }), false);
			assert.equal(lib.pluginNeedsWebBuild({
				name: "foo", title: "Foo", hostEntrypoint: "host.js", instanceEntrypoint: "instance.js",
				ctlEntrypoint: "ctl.js", messages: [],
			}), false);
		});
		it("should be true for plugins with web or controller code or config fields", function() {
			assert.equal(lib.pluginNeedsWebBuild({ name: "foo", title: "Foo", webEntrypoint: "web.js" }), true);
			assert.equal(lib.pluginNeedsWebBuild({
				name: "foo", title: "Foo", controllerEntrypoint: "controller.js",
			}), true);
			for (const field of [
				"controllerConfigFields", "hostConfigFields", "instanceConfigFields", "controlConfigFields",
			]) {
				assert.equal(lib.pluginNeedsWebBuild({ name: "foo", title: "Foo", [field]: {} }), true, field);
			}
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
			await lib.invokeHook(plugins, "test");
			assert(betaTestCalled, "Hook was not called");
		});
		it("should pass and return args", async function() {
			let result = await lib.invokeHook(plugins, "pass", 1234);
			assert.deepEqual(result, [1234]);
		});
		it("should ignore errors", async function() {
			await lib.invokeHook(plugins, "error");
		});
	});
});
