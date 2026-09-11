"use strict";
const assert = require("assert").strict;
const mock = require("../mock");

const host = require("@clusterio/host");

describe("host/src/BaseInstancePlugin", function() {
	describe("class BaseInstancePlugin", function() {
		const info = { name: "test" };
		let instancePlugin;
		it("should be constructible", async function() {
			instancePlugin = new host.BaseInstancePlugin(
				info, new mock.MockInstance(), new mock.MockHost(), new mock.MockLogger()
			);
			await instancePlugin.init();
			assert.equal(instancePlugin.instance.hooks.size, 0);
		});
		it("should be constructible from a load context", async function() {
			const instance = new mock.MockInstance();
			const mockHost = new mock.MockHost();
			const logger = new mock.MockLogger();
			const plugin = host.BaseInstancePlugin.fromContext({ plugin: info, instance, host: mockHost, logger });
			assert.equal(plugin.info, info);
			assert.equal(plugin.instance, instance);
			assert.equal(plugin.host, mockHost);
			assert.equal(plugin.logger, logger);
		});
		it("should attach overridden hooks", async function() {
			let calls = [];
			class InstancePlugin extends host.BaseInstancePlugin {
				async onStart() { calls.push(["start", this]); }
				onExit() { calls.push(["exit"]); }
				async onOutput(parsed, line) { calls.push(["output", parsed, line]); }
			}
			const instance = new mock.MockInstance();
			const plugin = new InstancePlugin(info, instance, new mock.MockHost(), new mock.MockLogger());
			assert.deepEqual([...instance.hooks.attached], ["test"]);
			assert.equal(instance.hooks.stop.size, 0);

			await instance.hooks.start.invoke();
			await instance.hooks.exit.invoke();
			await instance.hooks.output.invoke({ type: "generic" }, "line");
			assert.deepEqual(calls, [["start", plugin], ["exit"], ["output", { type: "generic" }, "line"]]);
		});
		it("should detach hooks", async function() {
			class InstancePlugin extends host.BaseInstancePlugin {
				async onStart() { }
			}
			const instance = new mock.MockInstance();
			const plugin = new InstancePlugin(info, instance, new mock.MockHost(), new mock.MockLogger());
			assert.equal(instance.hooks.size, 1);
			plugin.detachHooks();
			assert.equal(instance.hooks.size, 0);
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
});
