"use strict";
const mock = require("../mock");
const controller = require("@clusterio/controller");

describe("controller/src/BaseControllerPlugin", function() {
	describe("class BaseControllerPlugin", function() {
		let controllerPlugin;
		it("should be constructible", async function() {
			controllerPlugin = new controller.BaseControllerPlugin({}, {}, {}, new mock.MockLogger());
			await controllerPlugin.init();
		});
		it("should define defaults for hooks", async function() {
			await controllerPlugin.onInstanceStatusChanged({}, "running", "initialized");
			await controllerPlugin.onControllerConfigFieldChanged({}, "foo", null);
			await controllerPlugin.onInstanceConfigFieldChanged({}, {}, "foo", null);
			await controllerPlugin.onMetrics();
			await controllerPlugin.onShutdown();
			controllerPlugin.onHostConnectionEvent({}, "connect");
			await controllerPlugin.onPrepareHostDisconnect({});
		});
	});
});
