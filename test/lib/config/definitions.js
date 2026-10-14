import assert from "node:assert/strict";

import * as lib from "@clusterio/lib";


describe("lib/config/definitions", function() {
	describe("addPluginConfigFields()", function() {
		after(function() {
			delete lib.CtlConfig.fieldDefinitions["ctl_test.field"];
		});

		it("should add ctl config fields", function() {
			lib.addPluginConfigFields([{
				name: "ctl_test",
				ctlConfigFields: { "ctl_test.field": { type: "string", initialValue: "value" } },
			}]);
			const config = new lib.CtlConfig("control");
			assert.equal(config.get("ctl_test.field"), "value");
		});
		it("should reject ctl config fields not named after the plugin", function() {
			assert.throws(
				() => lib.addPluginConfigFields([{
					name: "ctl_test",
					ctlConfigFields: { "other.field": { type: "string" } },
				}]),
				new Error("Expected name of config field 'other.field' for ctl_test to start with 'ctl_test.'")
			);
		});
	});
});
