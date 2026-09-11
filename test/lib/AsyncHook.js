"use strict";
const assert = require("assert").strict;

const mock = require("../mock");
const lib = require("@clusterio/lib");


describe("lib/AsyncHook", function() {
	describe("class AsyncHook", function() {
		let logger;
		let hook;
		beforeEach(function() {
			logger = new mock.MockLogger();
			logger.errors = [];
			logger.error = msg => logger.errors.push(msg);
			hook = new lib.AsyncHook(logger);
		});

		it("should track attached handlers", function() {
			assert.equal(hook.size, 0);
			hook.attach("alpha", () => {});
			hook.attach("beta", () => {});
			assert.equal(hook.size, 2);
			assert.deepEqual([...hook.attached], ["alpha", "beta"]);
		});
		it("should reject duplicate handler names", function() {
			hook.attach("alpha", () => {});
			assert.throws(
				() => hook.attach("alpha", () => {}),
				new Error("Handler with name alpha is already attached")
			);
		});
		it("should detach handlers", async function() {
			let called = false;
			hook.attach("alpha", () => { called = true; });
			hook.detach("alpha");
			hook.detach("missing");
			await hook.invoke();
			assert.equal(called, false);
			assert.equal(hook.size, 0);
		});
		it("should clear all handlers", function() {
			hook.attach("alpha", () => {});
			hook.attach("beta", () => {});
			hook.clear();
			assert.equal(hook.size, 0);
		});
		it("should invoke all handlers with the given arguments", async function() {
			let calls = [];
			hook.attach("alpha", (a, b) => { calls.push(["alpha", a, b]); });
			hook.attach("beta", async (a, b) => { calls.push(["beta", a, b]); });
			await hook.invoke(1, "two");
			assert.deepEqual(calls, [["alpha", 1, "two"], ["beta", 1, "two"]]);
		});
		it("should log and ignore errors thrown by handlers", async function() {
			let betaCalled = false;
			hook.attach("alpha", () => { throw new Error("sync"); });
			hook.attach("beta", async () => { betaCalled = true; });
			hook.attach("gamma", async () => { throw new Error("async"); });
			await hook.invoke();
			assert(betaCalled, "beta was not called");
			assert.equal(logger.errors.length, 2);
			assert(logger.errors[0].startsWith('Ignoring error in hook "alpha":'), logger.errors[0]);
			assert(logger.errors[1].startsWith('Ignoring error in hook "gamma":'), logger.errors[1]);
		});
		it("should time out handlers that never resolve", async function() {
			hook = new lib.AsyncHook(logger, 10);
			hook.attach("stuck", () => new Promise(() => {}));
			hook.attach("fast", () => 1);
			assert.deepEqual(await hook.collect(), [1]);
			assert.equal(logger.errors.length, 1);
			assert(logger.errors[0].includes("Hook stuck timed out after 10ms"), logger.errors[0]);
		});
		it("should collect results from handlers", async function() {
			hook.attach("alpha", arg => arg);
			hook.attach("beta", () => undefined);
			hook.attach("gamma", async arg => arg * 2);
			hook.attach("delta", () => { throw new Error("Test"); });
			assert.deepEqual(await hook.collect(21), [21, 42]);
		});
		it("should collect results with their source", async function() {
			hook.attach("alpha", arg => arg);
			hook.attach("beta", () => undefined);
			hook.attach("gamma", async arg => arg * 2);
			assert.deepEqual(await hook.collectEntries(21), [["alpha", 21], ["gamma", 42]]);
		});
		it("should provide a stable listener bound to the hook", async function() {
			let calls = [];
			hook.attach("alpha", arg => { calls.push(arg); });
			const { listener } = hook;
			assert.equal(listener, hook.listener);
			await listener("value");
			assert.deepEqual(calls, ["value"]);
		});
	});

	describe("class AsyncHookCollection", function() {
		class TestHooks extends lib.AsyncHookCollection {
			constructor(logger) {
				super(logger);
				this.first = this.newHook();
				this.second = this.newHook();
			}
		}

		let hooks;
		beforeEach(function() {
			hooks = new TestHooks(new mock.MockLogger());
		});

		it("should count each name once across hooks", function() {
			hooks.first.attach("alpha", () => {});
			hooks.second.attach("alpha", () => {});
			hooks.second.attach("beta", () => {});
			assert.equal(hooks.size, 2);
			assert.deepEqual([...hooks.attached], ["alpha", "beta"]);
		});
		it("should detach a name from all hooks", function() {
			hooks.first.attach("alpha", () => {});
			hooks.second.attach("alpha", () => {});
			hooks.second.attach("beta", () => {});
			hooks.detachAll("alpha");
			assert.equal(hooks.first.size, 0);
			assert.deepEqual([...hooks.second.attached], ["beta"]);
		});
		it("should clear all hooks", function() {
			hooks.first.attach("alpha", () => {});
			hooks.second.attach("beta", () => {});
			hooks.clearAll();
			assert.equal(hooks.size, 0);
		});
	});
});
