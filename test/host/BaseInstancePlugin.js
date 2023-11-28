"use strict";
const assert = require("assert").strict;
const mock = require("../mock");

const host = require("@clusterio/host");

describe("host/src/BaseInstancePlugin", function() {
	describe("class BaseInstancePlugin", function() {
		let instancePlugin;
		it("should be constructible", async function() {
			instancePlugin = new host.BaseInstancePlugin({}, new mock.MockInstance(), {});
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
});
