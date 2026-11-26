import t, { type Test } from "tap";
import * as lib from "@clusterio/lib";

function pluginInfo(info: object) {
	return info as lib.PluginNodeEnvInfo;
}

// Copy of InstanceConfig whose field definitions tests can add to
function testInstanceConfig() {
	class TestInstanceConfig extends lib.InstanceConfig {
		static fieldDefinitions = { ...lib.InstanceConfig.fieldDefinitions };
	}
	// Plugin fields are not part of the InstanceConfig field types
	return TestInstanceConfig as unknown as typeof lib.Config<any>;
}

// Remove fields added to the global config classes when the test ends
function cleanupFields(test: Test, pluginName: string) {
	test.teardown(() => {
		for (const Config of [lib.ControllerConfig, lib.HostConfig, lib.InstanceConfig, lib.CtlConfig]) {
			const defs = Config.fieldDefinitions as Record<string, unknown>;
			for (const name of Object.keys(defs)) {
				if (name.startsWith(`${pluginName}.`)) {
					delete defs[name];
				}
			}
		}
	});
}

t.test("ControllerConfig", async t1 => {
	t1.test("migrations()", async t2 => {
		t2.test("renames controller.external_address to controller.public_url", async t3 => {
			const config = new lib.ControllerConfig("controller", {
				"controller.external_address": "https://example.com/",
			});
			t3.equal(config.get("controller.public_url"), "https://example.com/");
			t3.notOk(Object.hasOwn(config.toJSON(), "controller.external_address"));
		});
		t2.test("converts transfer_min_progress from KiB per 30 s to KiB/s", async t3 => {
			const config = new lib.ControllerConfig("controller", {
				"controller.transfer_min_progress": 60,
			});
			t3.equal(config.get("controller.transfer_min_speed"), 2);
			t3.notOk(Object.hasOwn(config.toJSON(), "controller.transfer_min_progress"));
		});
		t2.test("drops the old transfer_min_progress default so the new default applies", async t3 => {
			const config = new lib.ControllerConfig("controller", {
				"controller.transfer_min_progress": 30,
			});
			t3.equal(config.get("controller.transfer_min_speed"), 64);
		});
		t2.test("passes a non number transfer_min_progress through unchanged", async t3 => {
			const migrated = lib.ControllerConfig.migrations({ "controller.transfer_min_progress": "fast" });
			t3.strictSame(migrated, { "controller.transfer_min_speed": "fast" });
		});
		t2.test("leaves configs without old fields alone", async t3 => {
			t3.strictSame(lib.ControllerConfig.migrations({ "controller.name": "a" }), { "controller.name": "a" });
		});
	});

	t1.test("controller.static_url", async t2 => {
		t2.test("accepts empty values and URLs with a /static/ path", async t3 => {
			const config = new lib.ControllerConfig("controller");
			for (const value of [null, "", "static/", "./static/", "/static/", "http://example/static/"]) {
				t3.doesNotThrow(() => config.set("controller.static_url", value), String(value));
			}
		});
		t2.test("rejects other paths", async t3 => {
			const config = new lib.ControllerConfig("controller");
			t3.throws(
				() => config.set("controller.static_url", "http://example/foo/static/"),
				new lib.InvalidValueError(
					"Failed validation of controller.static_url: Path component of static_url must be " +
					"/static/ not /foo/static/."
				),
			);
		});
		t2.test("rejects invalid URLs", async t3 => {
			const config = new lib.ControllerConfig("controller");
			t3.throws(
				() => config.set("controller.static_url", "http://:80"),
				new lib.InvalidValueError("Failed validation of controller.static_url: Invalid URL"),
			);
		});
	});
});

t.test("HostConfig", async t1 => {
	t1.test("host.id", async t2 => {
		t2.test("defaults to a random 31 bit integer", async t3 => {
			t3.intercept(Math, "random", { value: () => 0.5 });
			t3.equal(new lib.HostConfig("host").get("host.id"), 2 ** 30);
		});
	});
});

t.test("InstanceConfig", async t1 => {
	t1.test("migrations()", async t2 => {
		t2.test("converts boolean sync settings to enabled and disabled", async t3 => {
			const config = new lib.InstanceConfig("controller", {
				"factorio.sync_adminlist": true,
				"factorio.sync_whitelist": false,
				"factorio.sync_banlist": "bidirectional",
			});
			t3.equal(config.get("factorio.sync_adminlist"), "enabled");
			t3.equal(config.get("factorio.sync_whitelist"), "disabled");
			t3.equal(config.get("factorio.sync_banlist"), "bidirectional");
		});
	});

	t1.test("isInheritable()", async t2 => {
		t2.test("allows regular fields", async t3 => {
			t3.equal(lib.InstanceConfig.isInheritable("factorio.version"), true);
			t3.equal(lib.InstanceConfig.isInheritable("instance.auto_start"), true);
		});
		t2.test("rejects unknown fields", async t3 => {
			t3.equal(lib.InstanceConfig.isInheritable("no.field"), false);
		});
		t2.test("rejects hidden fields", async t3 => {
			t3.equal(lib.InstanceConfig.isInheritable("instance.id"), false);
		});
		t2.test("rejects fields the controller cannot access", async t3 => {
			t3.equal(lib.InstanceConfig.isInheritable("factorio.host_assigned_game_port"), false);
		});
		t2.test("rejects identity, port and secret fields", async t3 => {
			for (const name of lib.InstanceConfig.uninheritableFields) {
				t3.equal(lib.InstanceConfig.isInheritable(name), false, name);
			}
		});
	});

	t1.test("isInherited()", async t2 => {
		t2.test("is false without a template", async t3 => {
			const config = new lib.InstanceConfig("controller", {
				"instance.inherited_fields": { "factorio.version": true },
			});
			t3.equal(config.isInherited("factorio.version"), false);
		});
		t2.test("follows inherited_fields when a template is set", async t3 => {
			const config = new lib.InstanceConfig("controller", {
				"instance.template_id": 1,
				"instance.inherited_fields": { "factorio.version": true },
			});
			t3.equal(config.isInherited("factorio.version"), true);
			t3.equal(config.isInherited("factorio.game_port"), false);
		});
		t2.test("reports object properties not set on the instance as inherited", async t3 => {
			const config = new lib.InstanceConfig("controller", {
				"instance.template_id": 1,
				"instance.inherited_fields": { "factorio.settings": ["name"] },
			});
			t3.equal(config.isInherited("factorio.settings"), true);
			t3.equal(config.isInherited("factorio.settings", "max_players"), true);
			t3.equal(config.isInherited("factorio.settings", "name"), false);
		});
	});

	t1.test("instance.id", async t2 => {
		t2.test("defaults to a random 31 bit integer", async t3 => {
			t3.intercept(Math, "random", { value: () => 0.25 });
			t3.equal(new lib.InstanceConfig("controller").get("instance.id"), 2 ** 29);
		});
	});

	t1.test("factorio.version", async t2 => {
		t2.test("accepts latest, channels and versions", async t3 => {
			const config = new lib.InstanceConfig("controller");
			for (const value of ["latest", "stable", "1.1", "1.1.87"]) {
				t3.doesNotThrow(() => config.set("factorio.version", value), value);
			}
		});
		t2.test("rejects other values", async t3 => {
			const config = new lib.InstanceConfig("controller");
			t3.throws(
				() => config.set("factorio.version", "1"),
				new lib.InvalidValueError(
					"Failed validation of factorio.version: " +
					"Value must be 'latest', a release channel, or match X.Y or X.Y.Z"
				),
			);
		});
	});

	t1.test("factorio.player_online_autosave_slots", async t2 => {
		t2.test("must be at least the number of autosave slots", async t3 => {
			const config = new lib.InstanceConfig("controller", { "factorio.settings": { autosave_slots: 5 } });
			t3.doesNotThrow(() => config.set("factorio.player_online_autosave_slots", 5));
			t3.throws(
				() => config.set("factorio.player_online_autosave_slots", 4),
				new lib.InvalidValueError(
					"Failed validation of factorio.player_online_autosave_slots: " +
					"Value cannot be less than the number of autosave slots"
				),
			);
		});
		t2.test("can be 0 to disable", async t3 => {
			const config = new lib.InstanceConfig("controller", { "factorio.settings": { autosave_slots: 5 } });
			t3.doesNotThrow(() => config.set("factorio.player_online_autosave_slots", 0));
		});
		t2.test("is unchecked when autosave_slots is not a number", async t3 => {
			const config = new lib.InstanceConfig("controller", { "factorio.settings": {} });
			t3.doesNotThrow(() => config.set("factorio.player_online_autosave_slots", 1));
		});
		t2.test("is checked again when autosave_slots changes", async t3 => {
			const config = new lib.InstanceConfig("controller", { "factorio.player_online_autosave_slots": 2 });
			t3.throws(
				() => config.set("factorio.settings", { autosave_slots: 3 }),
				new lib.InvalidValueError(
					"Failed validation of dependent factorio.player_online_autosave_slots: " +
					"Value cannot be less than the number of autosave slots"
				),
			);
		});
	});
});

t.test("addPluginFieldDefinitions()", async t1 => {
	t1.test("adds hidden load_plugin and version fields", async t2 => {
		const Config = testInstanceConfig();
		lib.addPluginFieldDefinitions(pluginInfo({ name: "plain" }), "instanceConfigFields", Config);
		const config = new Config("controller");
		t2.equal(config.get("plain.load_plugin"), true);
		t2.equal(config.get("plain.version"), "");
		t2.equal(Config.fieldDefinitions["plain.load_plugin"].restartRequired, true);
		t2.equal(Config.fieldDefinitions["plain.version"].hidden, true);
	});
	t1.test("merges in the plugin's fields for the given kind", async t2 => {
		const Config = testInstanceConfig();
		lib.addPluginFieldDefinitions(pluginInfo({
			name: "fields",
			instanceConfigFields: { "fields.a": { type: "string", initialValue: "a" } },
			hostConfigFields: { "fields.b": { type: "string", initialValue: "b" } },
		}), "instanceConfigFields", Config);
		const config = new Config("controller");
		t2.equal(config.get("fields.a"), "a");
		t2.notOk(Object.hasOwn(Config.fieldDefinitions, "fields.b"));
	});
	t1.test("rejects fields not named after the plugin", async t2 => {
		const Config = testInstanceConfig();
		t2.throws(
			() => lib.addPluginFieldDefinitions(pluginInfo({
				name: "fields",
				instanceConfigFields: { "fieldsx.a": { type: "string", optional: true } },
			}), "instanceConfigFields", Config),
			new Error("Expected name of config field 'fieldsx.a' for fields to start with 'fields.'"),
		);
	});
	t1.test("ignores features outside of instance configs", async t2 => {
		const Config = testInstanceConfig();
		lib.addPluginFieldDefinitions(
			pluginInfo({ name: "feat", features: ["SavePatching"] }), "hostConfigFields", Config,
		);
		t2.equal(Config.fieldDefinitions["feat.load_plugin"].validator, undefined);
		t2.equal(Config.fieldDefinitions["feat.load_plugin"].initialValue, true);
	});
	t1.test("ignores features without config requirements", async t2 => {
		const Config = testInstanceConfig();
		lib.addPluginFieldDefinitions(pluginInfo({ name: "feat", features: [] }), "instanceConfigFields", Config);
		const config = new Config("controller", { "factorio.enable_save_patching": false });
		t2.equal(config.get("feat.load_plugin"), true);
		t2.equal(Config.fieldDefinitions["feat.load_plugin"].validator, undefined);
	});

	for (const [feature, field, description] of [
		["SavePatching", "factorio.enable_save_patching", "save patching"],
		["ScriptCommands", "factorio.enable_script_commands", "script commands"],
		["LuaUdp", "factorio.enable_lua_udp", "Lua UDP"],
	]) {
		t1.test(`${feature} requires ${field}`, async t2 => {
			t2.test("defaults load_plugin to whether the field is enabled", async t3 => {
				const Config = testInstanceConfig();
				lib.addPluginFieldDefinitions(
					pluginInfo({ name: "feat", features: [feature] }), "instanceConfigFields", Config,
				);
				t3.equal(new Config("controller", { [field]: true }).get("feat.load_plugin"), true);
				t3.equal(new Config("controller", { [field]: false }).get("feat.load_plugin"), false);
			});
			t2.test("rejects loading the plugin while the field is disabled", async t3 => {
				const Config = testInstanceConfig();
				lib.addPluginFieldDefinitions(
					pluginInfo({ name: "feat", features: [feature] }), "instanceConfigFields", Config,
				);
				const config = new Config("controller", { [field]: false });
				t3.throws(
					() => config.set("feat.load_plugin", true),
					new lib.InvalidValueError(
						`Failed validation of feat.load_plugin: Plugin feat requires ${description}`
					),
				);
				t3.doesNotThrow(() => config.set("feat.load_plugin", false));
				config.set(field, true);
				t3.doesNotThrow(() => config.set("feat.load_plugin", true));
			});
			t2.test("rejects disabling the field while the plugin is loaded", async t3 => {
				const Config = testInstanceConfig();
				lib.addPluginFieldDefinitions(
					pluginInfo({ name: "feat", features: [feature] }), "instanceConfigFields", Config,
				);
				const config = new Config("controller", { [field]: true });
				t3.throws(
					() => config.set(field, false),
					new lib.InvalidValueError(
						`Failed validation of dependent feat.load_plugin: Plugin feat requires ${description}`
					),
				);
				t3.equal(config.get(field), true);
			});
		});
	}

	t1.test("requires every listed feature", async t2 => {
		const Config = testInstanceConfig();
		lib.addPluginFieldDefinitions(
			pluginInfo({ name: "feat", features: ["SavePatching", "ScriptCommands"] }),
			"instanceConfigFields", Config,
		);
		t2.strictSame(
			Config.fieldDefinitions["feat.load_plugin"].dependsOn,
			["factorio.enable_save_patching", "factorio.enable_script_commands"],
		);
		const config = new Config("controller", {
			"factorio.enable_save_patching": true, "factorio.enable_script_commands": false,
		});
		t2.equal(config.get("feat.load_plugin"), false);
		t2.throws(
			() => config.set("feat.load_plugin", true),
			new lib.InvalidValueError("Failed validation of feat.load_plugin: Plugin feat requires script commands"),
		);
	});
});

t.test("addPluginConfigFields()", async t1 => {
	t1.test("adds only controller fields for plugins without host or instance code", async t2 => {
		cleanupFields(t2, "web_only");
		lib.addPluginConfigFields([pluginInfo({ name: "web_only" })]);
		t2.ok(Object.hasOwn(lib.ControllerConfig.fieldDefinitions, "web_only.load_plugin"));
		t2.notOk(Object.hasOwn(lib.HostConfig.fieldDefinitions, "web_only.load_plugin"));
		t2.notOk(Object.hasOwn(lib.InstanceConfig.fieldDefinitions, "web_only.load_plugin"));
	});
	t1.test("adds host fields for plugins with a host entrypoint", async t2 => {
		cleanupFields(t2, "host_only");
		lib.addPluginConfigFields([pluginInfo({
			name: "host_only",
			hostEntrypoint: "host",
			hostConfigFields: { "host_only.a": { type: "string", initialValue: "a" } },
		})]);
		t2.ok(Object.hasOwn(lib.ControllerConfig.fieldDefinitions, "host_only.load_plugin"));
		t2.equal(new lib.HostConfig("host").get("host_only.a" as "host.name"), "a");
		t2.notOk(Object.hasOwn(lib.InstanceConfig.fieldDefinitions, "host_only.load_plugin"));
	});
	t1.test("adds host and instance fields for plugins with an instance entrypoint", async t2 => {
		cleanupFields(t2, "inst");
		lib.addPluginConfigFields([pluginInfo({ name: "inst", instanceEntrypoint: "instance" })]);
		t2.ok(Object.hasOwn(lib.ControllerConfig.fieldDefinitions, "inst.load_plugin"));
		t2.ok(Object.hasOwn(lib.HostConfig.fieldDefinitions, "inst.load_plugin"));
		t2.ok(Object.hasOwn(lib.InstanceConfig.fieldDefinitions, "inst.load_plugin"));
	});
	t1.test("adds ctl config fields", async t2 => {
		cleanupFields(t2, "ctl_test");
		lib.addPluginConfigFields([pluginInfo({
			name: "ctl_test",
			ctlConfigFields: { "ctl_test.field": { type: "string", initialValue: "value" } },
		})]);
		t2.equal(new lib.CtlConfig("control").get("ctl_test.field" as "ctl.controller_url"), "value");
	});
	t1.test("rejects ctl config fields not named after the plugin", async t2 => {
		cleanupFields(t2, "ctl_bad");
		t2.throws(
			() => lib.addPluginConfigFields([pluginInfo({
				name: "ctl_bad",
				ctlConfigFields: { "other.field": { type: "string" } },
			})]),
			new Error("Expected name of config field 'other.field' for ctl_bad to start with 'ctl_bad.'"),
		);
		t2.notOk(Object.hasOwn(lib.CtlConfig.fieldDefinitions, "other.field"));
	});
});
