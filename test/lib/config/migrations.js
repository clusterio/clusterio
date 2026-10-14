import * as lib from "@clusterio/lib";
import assert from "node:assert/strict";

// Each migration test should indicate which version introduced the migration

describe("lib/config/definitions/migrations", function() {
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
	describe("Ctl Config", function() {

	});
	describe("Plugin migrations", function() {
		const pluginInfo = {
			name: "test_plugin",
			version: "1.2.0",
			instanceEntrypoint: "instance.js",
			instanceConfigFields: {
				"test_plugin.delay": { type: "number", initialValue: 1 },
			},
		};
		before(function() {
			lib.addPluginConfigFields([pluginInfo]);
		});
		afterEach(function() {
			lib.InstanceConfig.pluginMigrations.clear();
		});
		after(function() {
			for (const Config of [lib.ControllerConfig, lib.HostConfig, lib.InstanceConfig]) {
				for (const name of Object.keys(Config.fieldDefinitions)) {
					if (name.startsWith("test_plugin.")) {
						delete Config.fieldDefinitions[name];
					}
				}
			}
		});

		it("should run attached migrations on load", function() {
			lib.InstanceConfig.pluginMigrations.attach("test_plugin", config => (
				lib.renameConfigPrefix(config, "old_plugin.", "test_plugin.")
			));
			const config = lib.InstanceConfig.fromJSON({
				"old_plugin.load_plugin": false,
				"old_plugin.delay": 5,
			}, "controller");
			assert.equal(config.get("test_plugin.load_plugin"), false);
			assert.equal(config.get("test_plugin.delay"), 5);
			assert.equal(config.toJSON()["old_plugin.delay"], undefined);
		});
		it("should run plugin migrations after core migrations", function() {
			lib.InstanceConfig.pluginMigrations.attach("test_plugin", config => {
				assert.equal(config["factorio.sync_adminlist"], "enabled");
				return config;
			});
			lib.InstanceConfig.fromJSON({ "factorio.sync_adminlist": true }, "controller");
		});
		it("should give migrations the version the config was saved with", function() {
			let seen;
			lib.InstanceConfig.pluginMigrations.attach("test_plugin", config => {
				seen = config["test_plugin.version"];
				return config;
			});
			const config = lib.InstanceConfig.fromJSON({ "test_plugin.version": "1.1.0" }, "controller");
			assert.equal(seen, "1.1.0");
			assert.equal(config.get("test_plugin.version"), "1.1.0");
		});
		it("should default the version of new configs to the loaded plugin version", function() {
			const config = new lib.InstanceConfig("controller");
			assert.equal(config.get("test_plugin.version"), "1.2.0");
		});
		it("should update versions with setPluginVersions", function() {
			const config = lib.InstanceConfig.fromJSON({ "test_plugin.version": "1.1.0" }, "controller");
			assert.equal(lib.setPluginVersions(config, [pluginInfo]), true);
			assert.equal(config.get("test_plugin.version"), "1.2.0");
			assert.equal(lib.setPluginVersions(config, [pluginInfo]), false);
		});
	});
});
