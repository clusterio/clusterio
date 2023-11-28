"use strict";
const assert = require("assert").strict;

const mock = require("../mock");
const lib = require("@clusterio/lib");


describe("lib/plugin", function() {
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
