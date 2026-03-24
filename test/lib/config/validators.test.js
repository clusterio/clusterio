"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");
const validators = lib.Config.validators;
const { ControllerConfig, HostConfig, InstanceConfig, ControlConfig } = lib;

describe("lib/config/validators", function() {
	describe("all", function() {
		it("should call all validators in order", function() {
			let calls = [];

			function v1(value, config) {
				calls.push("v1");
			}
			function v2(value, config) {
				calls.push("v2");
			}

			const combined = validators.all(v1, v2);
			combined("value", {});

			assert.deepEqual(calls, ["v1", "v2"], "validators were not called in order");
		});

		it("should propagate errors from validators", function() {
			function v1() {}
			function v2() {
				throw new Error("failure");
			}

			const combined = validators.all(v1, v2);

			assert.throws(
				() => combined("value", {}),
				/failure/,
				"error from validator was not propagated"
			);
		});
	});

	describe("optional", function() {
		it("should skip validation when value is null", function() {
			let called = false;

			function validator() {
				called = true;
			}

			const wrapped = validators.optional(validator);
			wrapped(null, {});

			assert.equal(called, false, "validator should not have been called");
		});

		it("should run validator when value is not null", function() {
			let called = false;

			function validator() {
				called = true;
			}

			const wrapped = validators.optional(validator);
			wrapped("value", {});

			assert.equal(called, true, "validator was not called");
		});
	});

	describe("greaterThan", function() {
		it("should allow values greater than min", function() {
			const validator = validators.greaterThan(5);
			assert.doesNotThrow(() => validator(6));
		});

		it("should throw if value equals min", function() {
			const validator = validators.greaterThan(5);

			assert.throws(
				() => validator(5),
				/Value must be greater than 5/,
				"did not throw on equal value"
			);
		});

		it("should throw if value is less than min", function() {
			const validator = validators.greaterThan(5);

			assert.throws(
				() => validator(4),
				/Value must be greater than 5/,
				"did not throw on smaller value"
			);
		});
	});

	describe("greaterThanZero", function() {
		it("should allow values greater than zero", function() {
			assert.doesNotThrow(() => validators.greaterThanZero(1));
		});

		it("should throw on zero", function() {
			assert.throws(
				() => validators.greaterThanZero(0),
				/Value must be greater than 0/
			);
		});

		it("should throw on negative values", function() {
			assert.throws(
				() => validators.greaterThanZero(-1),
				/Value must be greater than 0/
			);
		});
	});

	describe("greaterThanEqual", function() {
		it("should allow values greater than min", function() {
			const validator = validators.greaterThanEqual(5);
			assert.doesNotThrow(() => validator(6));
		});

		it("should allow values equal to min", function() {
			const validator = validators.greaterThanEqual(5);
			assert.doesNotThrow(() => validator(5));
		});

		it("should throw if value is less than min", function() {
			const validator = validators.greaterThanEqual(5);

			assert.throws(
				() => validator(4),
				/Value must be greater than 5/,
				"did not throw on smaller value"
			);
		});
	});

	describe("greaterThanEqualZero", function() {
		it("should allow zero", function() {
			assert.doesNotThrow(() => validators.greaterThanEqualZero(0));
		});

		it("should allow positive values", function() {
			assert.doesNotThrow(() => validators.greaterThanEqualZero(1));
		});

		it("should throw on negative values", function() {
			assert.throws(
				() => validators.greaterThanEqualZero(-1),
				/Value must be greater than 0/
			);
		});
	});

	describe("integer", function() {
		it("should allow integer values", function() {
			assert.doesNotThrow(() => validators.integer(10));
		});

		it("should throw on non-integer values", function() {
			assert.throws(
				() => validators.integer(1.5),
				/Value must be an integer/,
				"did not throw on float"
			);
		});
	});

	describe("filePath", function() {
		it("should accept valid paths", function() {
			assert.doesNotThrow(() => validators.filePath("test/file.txt"));
			assert.doesNotThrow(() => validators.filePath("/absolute/path"));
		});

		it("should throw if value is not a string", function() {
			// This is the only case that will cause path.resolve to throw on posix
			assert.throws(
				() => validators.filePath(null),
				/Value must be a valid path/
			);
		});
	});
});

describe("lib/config/definitions/validators", function() {
	describe("Controller Config", function() {

	});

	describe("Host Config", function() {

	});

	describe("Instance Config", function() {
		it("should validate factorio.version", function() {
			const config = new InstanceConfig("controller");

			// valid cases
			assert.doesNotThrow(() => config.set("factorio.version", "latest"));
			assert.doesNotThrow(() => config.set("factorio.version", "1.1"));
			assert.doesNotThrow(() => config.set("factorio.version", "1.1.87"));

			// invalid case
			assert.throws(
				() => config.set("factorio.version", "invalidValue"),
				/Value must be be 'latest', or match X.Y, or match X.Y.Z/
			);
		});

		describe("factorio.player_online_autosave_slots", function() {
			it("should validate against autosave slots", function() {
				const config = new InstanceConfig("controller", {
					"factorio.settings": {
						autosave_slots: 5,
					},
				});

				// valid: equal
				assert.doesNotThrow(() => config.set("factorio.player_online_autosave_slots", 5));

				// valid: greater
				assert.doesNotThrow(() => config.set("factorio.player_online_autosave_slots", 6));

				// invalid: less than autosave_slots
				assert.throws(
					() => config.set("factorio.player_online_autosave_slots", 4),
					/Value cannot be less than the number of autosave slots/
				);
			});
			it("should allow when autosave_slots is not a number", function() {
				const config = new InstanceConfig("controller", {
					"factorio.settings": {
						autosave_slots: null,
					},
				});

				assert.doesNotThrow(() => config.set("factorio.player_online_autosave_slots", 0));
				assert.doesNotThrow(() => config.set("factorio.player_online_autosave_slots", 1));
			});
		});

		describe("plugin.load_plugin", function() {
			class TestInstanceConfig extends InstanceConfig {
				static fieldDefinitions = { ...InstanceConfig.fieldDefinitions };
			}
			it("should validate against factorio.enable_save_patching", function() {
				lib.addPluginFieldDefinitions(
					{name: "save_patching", features: ["SavePatching"] },
					"instanceConfigFields", TestInstanceConfig
				);

				const config = new TestInstanceConfig("controller");

				// valid: does not require script commands
				assert.doesNotThrow(() => config.set("factorio.enable_script_commands", false));

				// valid: can have load disabled
				assert.doesNotThrow(() => config.set("save_patching.load_plugin", false));

				// valid: does not require save patching when not loaded
				assert.doesNotThrow(() => config.set("factorio.enable_save_patching", false));

				// invalid: requires save patching when loaded
				assert.throws(
					() => config.set("save_patching.load_plugin", true),
					/requires save patching/
				);
			});
			it("should validate against factorio.enable_script_commands", function() {
				lib.addPluginFieldDefinitions(
					{ name: "script_commands", features: ["ScriptCommands"] },
					"instanceConfigFields", TestInstanceConfig
				);

				const config = new TestInstanceConfig("controller");

				// valid: does not require save patching
				assert.doesNotThrow(() => config.set("factorio.enable_save_patching", false));

				// valid: can have load disabled
				assert.doesNotThrow(() => config.set("script_commands.load_plugin", false));

				// valid: does not require script commands when not loaded
				assert.doesNotThrow(() => config.set("factorio.enable_script_commands", false));

				// invalid: requires script commands when loaded
				assert.throws(
					() => config.set("script_commands.load_plugin", true),
					/requires script commands/
				);
			});
			it("should allow when no feature flags are present", function() {
				lib.addPluginFieldDefinitions(
					{ name: "no_features", features: [] },
					"instanceConfigFields", TestInstanceConfig
				);

				const config = new TestInstanceConfig("controller");

				// valid: does not require save patching
				assert.doesNotThrow(() => config.set("factorio.enable_save_patching", false));

				// valid: does not require script commands
				assert.doesNotThrow(() => config.set("factorio.enable_script_commands", false));

				// valid: can have load disabled
				assert.doesNotThrow(() => config.set("script_commands.load_plugin", false));

				// no invalid case
			});
		});
	});

	describe("Control Config", function() {

	});
});
