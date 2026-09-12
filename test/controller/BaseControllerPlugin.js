import assert from "node:assert/strict";

import * as mock from "../mock.js";
import * as controller from "@clusterio/controller";

describe("controller/src/BaseControllerPlugin", function() {
	describe("class BaseControllerPlugin", function() {
		const info = { name: "test" };
		let mockController;
		beforeEach(function() {
			mockController = new mock.MockController();
		});

		it("should be constructible", async function() {
			const plugin = new controller.BaseControllerPlugin(info, mockController, {}, new mock.MockLogger());
			await plugin.init();
			assert.equal(mockController.hooks.size, 0);
		});
		it("should be constructible from a load context", async function() {
			const logger = new mock.MockLogger();
			const plugin = controller.BaseControllerPlugin.fromContext({
				plugin: info, controller: mockController, metrics: {}, logger,
			});
			assert.equal(plugin.info, info);
			assert.equal(plugin.controller, mockController);
			assert.equal(plugin.logger, logger);
		});
		it("should attach overridden hooks", async function() {
			let calls = [];
			class ControllerPlugin extends controller.BaseControllerPlugin {
				async onSaveData() { calls.push(["save", this]); }
				async onInstanceStatusChanged(instance, prev) { calls.push(["status", instance, prev]); }
				onHostConnectionEvent(connection, event) { calls.push(["host", connection, event]); }
			}
			const plugin = new ControllerPlugin(info, mockController, {}, new mock.MockLogger());
			assert.deepEqual([...mockController.hooks.attached], ["test"]);
			assert.equal(mockController.hooks.shutdown.size, 0);

			await mockController.hooks.save.invoke();
			await mockController.hooks.instanceStatusChanged.invoke("instance", "running");
			await mockController.hooks.hostConnectionEvent.invoke("connection", "connect");
			assert.deepEqual(calls, [
				["save", plugin],
				["status", "instance", "running"],
				["host", "connection", "connect"],
			]);
		});
		it("should detach hooks", async function() {
			class ControllerPlugin extends controller.BaseControllerPlugin {
				async onSaveData() { }
				async onShutdown() { }
			}
			const plugin = new ControllerPlugin(info, mockController, {}, new mock.MockLogger());
			assert.equal(mockController.hooks.size, 1);
			plugin.detachHooks();
			assert.equal(mockController.hooks.size, 0);
		});
	});
});
