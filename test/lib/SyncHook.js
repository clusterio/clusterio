import assert from "node:assert/strict";

import * as lib from "@clusterio/lib";


describe("lib/SyncHook", function() {
	describe("class SyncHook", function() {
		let hook;
		beforeEach(function() {
			hook = new lib.SyncHook();
		});

		it("should track attached handlers", function() {
			assert.equal(hook.size, 0);
			hook.attach("alpha", value => value);
			hook.attach("beta", value => value);
			assert.equal(hook.size, 2);
			assert.deepEqual([...hook.attached], ["alpha", "beta"]);
		});
		it("should reject duplicate handler names", function() {
			hook.attach("alpha", value => value);
			assert.throws(
				() => hook.attach("alpha", value => value),
				new Error("Handler with name alpha is already attached")
			);
		});
		it("should detach and clear handlers", function() {
			hook.attach("alpha", value => value);
			hook.attach("beta", value => value);
			hook.detach("alpha");
			assert.deepEqual([...hook.attached], ["beta"]);
			hook.clear();
			assert.equal(hook.size, 0);
		});
		it("should pass the value through handlers in attach order", function() {
			hook.attach("alpha", value => [...value, "alpha"]);
			hook.attach("beta", value => [...value, "beta"]);
			assert.deepEqual(hook.reduce([]), ["alpha", "beta"]);
		});
		it("should return the value unchanged with no handlers", function() {
			const value = {};
			assert.equal(hook.reduce(value), value);
		});
		it("should rethrow errors as a PluginError named after the handler", function() {
			hook.attach("alpha", () => { throw new Error("failed"); });
			assert.throws(
				() => hook.reduce(1),
				err => err instanceof lib.PluginError && err.pluginName === "alpha" && err.original.message === "failed"
			);
		});
	});
});
