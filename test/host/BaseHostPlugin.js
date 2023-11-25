"use strict";
const assert = require("assert").strict;
const mock = require("../mock");

const host = require("@clusterio/host");

describe("host/src/BaseHostPlugin", function() {
	describe("class BaseHostPlugin", function() {
		let hostPlugin;
		it("should be constructible", async function() {
			hostPlugin = new host.BaseHostPlugin({}, new mock.MockHost(), new mock.MockLogger());
			await hostPlugin.init();
		});
		it("should define defaults for hooks", async function() {
			await hostPlugin.onHostConfigFieldChanged();
			await hostPlugin.onMetrics();
			await hostPlugin.onShutdown();
			hostPlugin.onControllerConnectionEvent("connect");
			await hostPlugin.onPrepareControllerDisconnect();
		});
	});
});
