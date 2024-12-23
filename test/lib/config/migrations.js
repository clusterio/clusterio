"use strict";
const lib = require("@clusterio/lib");
const assert = require("assert").strict;

// Each migration test should indicate which version introduced the migration

describe("lib/config/migrations", function() {
	describe("Controller Config", function() {
		it("should migrate 'external_address' to 'public_url'", function() { // Alpha 19
			const config = lib.ControllerConfig.fromJSON({
				"controller.external_address": "https://example.com:4000",
			}, "controller");

			assert.equal(config.get("controller.public_url"), "https://example.com:4000",
				"public_url contains the wrong value");
			assert.equal(config.fields["controller.external_address"], undefined,
				"external_address was not removed");
		});
	});
	describe("Host Config", function() {

	});
	describe("Instance Config", function() {
		it("should migrate boolean sync to string enum", function() { // Alpha 19
			const configTrue = lib.InstanceConfig.fromJSON({
				"factorio.sync_adminlist": true,
				"factorio.sync_whitelist": true,
				"factorio.sync_banlist": true,
			}, "controller");

			assert.equal(configTrue.get("factorio.sync_adminlist"), "enabled", "sync_adminlist contains wrong value");
			assert.equal(configTrue.get("factorio.sync_whitelist"), "enabled", "sync_adminlist contains wrong value");
			assert.equal(configTrue.get("factorio.sync_banlist"), "enabled", "sync_adminlist contains wrong value");

			const configFalse = lib.InstanceConfig.fromJSON({
				"factorio.sync_adminlist": false,
				"factorio.sync_whitelist": false,
				"factorio.sync_banlist": false,
			}, "controller");

			assert.equal(configFalse.get("factorio.sync_adminlist"), "disabled", "sync_adminlist contains wrong value");
			assert.equal(configFalse.get("factorio.sync_whitelist"), "disabled", "sync_adminlist contains wrong value");
			assert.equal(configFalse.get("factorio.sync_banlist"), "disabled", "sync_adminlist contains wrong value");
		});
	});
	describe("Control Config", function() {

	});
});
