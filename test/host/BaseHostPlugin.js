"use strict";
const assert = require("assert").strict;
const mock = require("../mock");

const host = require("@clusterio/host");

describe("host/src/BaseHostPlugin", function() {
	describe("class BaseHostPlugin", function() {
		const info = { name: "test" };
		let mockHost;
		beforeEach(function() {
			mockHost = new mock.MockHost();
		});

		it("should be constructible", async function() {
			const plugin = new host.BaseHostPlugin(info, mockHost, new mock.MockLogger());
			await plugin.init();
			assert.equal(mockHost.hooks.size, 0);
		});
		it("should be constructible from a load context", async function() {
			const logger = new mock.MockLogger();
			const plugin = host.BaseHostPlugin.fromContext({ plugin: info, host: mockHost, logger });
			assert.equal(plugin.info, info);
			assert.equal(plugin.host, mockHost);
			assert.equal(plugin.logger, logger);
		});
		it("should attach overridden hooks", async function() {
			let calls = [];
			class HostPlugin extends host.BaseHostPlugin {
				async onHostConfigFieldChanged(field, curr, prev) { calls.push(["config", field, curr, prev]); }
				async onShutdown() { calls.push(["shutdown", this]); }
			}
			const plugin = new HostPlugin(info, mockHost, new mock.MockLogger());
			assert.deepEqual([...mockHost.hooks.attached], ["test"]);
			assert.equal(mockHost.hooks.metrics.size, 0);

			await mockHost.hooks.hostConfigFieldChanged.invoke("host.name", "new", "old");
			await mockHost.hooks.shutdown.invoke();
			assert.deepEqual(calls, [["config", "host.name", "new", "old"], ["shutdown", plugin]]);
		});
		it("should detach hooks", async function() {
			class HostPlugin extends host.BaseHostPlugin {
				async onShutdown() { }
			}
			const plugin = new HostPlugin(info, mockHost, new mock.MockLogger());
			assert.equal(mockHost.hooks.size, 1);
			plugin.detachHooks();
			assert.equal(mockHost.hooks.size, 0);
		});
	});
});
