import assert from "node:assert/strict";

import * as lib from "@clusterio/lib";


describe("lib/config/definitions", function() {
	describe("InstanceConfig", function() {
		describe("isInheritable()", function() {
			it("should allow regular fields", function() {
				assert.equal(lib.InstanceConfig.isInheritable("factorio.version"), true);
				assert.equal(lib.InstanceConfig.isInheritable("instance.auto_start"), true);
			});
			it("should reject identity, hidden, host only and unknown fields", function() {
				for (const name of [
					"instance.name", "instance.id", "instance.assigned_host", "instance.is_base",
					"instance.base_id", "instance.inherited_fields", "factorio.host_assigned_game_port", "no.field",
				]) {
					assert.equal(lib.InstanceConfig.isInheritable(name), false, name);
				}
			});
		});
		describe(".isInherited()", function() {
			it("should only report fields as inherited when a base is set", function() {
				const config = new lib.InstanceConfig("controller", {
					"instance.inherited_fields": { "factorio.version": true },
				});
				assert.equal(config.isInherited("factorio.version"), false);
				config.set("instance.base_id", 1);
				assert.equal(config.isInherited("factorio.version"), true);
				assert.equal(config.isInherited("factorio.game_port"), false);
			});
		});
		it("should not send inheritance fields to the host", function() {
			const config = new lib.InstanceConfig("controller", { "instance.base_id": 1 });
			const remote = config.toRemote("host");
			for (const name of ["instance.is_base", "instance.base_id", "instance.inherited_fields"]) {
				assert(!Object.hasOwn(remote, name), name);
			}
		});
		it("should not let control write inherited_fields", function() {
			const config = new lib.InstanceConfig("controller");
			assert.throws(
				() => config.set("instance.inherited_fields", { "factorio.version": true }, "control"),
				new lib.InvalidAccessError("Field 'instance.inherited_fields' is not accessible from control"),
			);
		});
	});

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
