import assert from "node:assert/strict";

import { modSettingFields } from "../../packages/web_ui/src/util/mod_settings.ts";

describe("web_ui/util/mod_settings", function() {
	describe("modSettingFields()", function() {
		const stored = new Map([
			["kept", { value: true }],
			["gone-number", { value: 2 }],
			["gone-color", { value: { r: 1, g: 0, b: 0, a: 1 } }],
			["gone-string", { value: "x" }],
		]);
		const prototypes = {
			"bool-setting": {
				"kept": { type: "bool-setting", name: "kept", mod: "b", setting_type: "startup", default_value: false },
				"map": {
					type: "bool-setting", name: "map", mod: "a", setting_type: "runtime-global", default_value: false,
				},
			},
			"string-setting": {
				"first": {
					type: "string-setting", name: "first", mod: "a", setting_type: "startup",
					default_value: "x", allowed_values: ["x", "y"],
					localised_name: ["name.first"], localised_description: ["description.first"],
				},
			},
			"unrelated": { "gone-number": { type: "unrelated", name: "gone-number", setting_type: "startup" } },
		};

		it("should split stored settings no prototype defines into unknown", function() {
			const { known, unknown } = modSettingFields(prototypes, "startup", stored);
			assert.deepEqual(known.map(field => field.name), ["first", "kept"]);
			assert.deepEqual(known[0].allowed_values, ["x", "y"]);
			assert.deepEqual(known[0].localised_name, ["name.first"]);
			assert.deepEqual(known[0].localised_description, ["description.first"]);
			assert.deepEqual(
				unknown.map(field => [field.name, field.type]),
				[["gone-color", "color-setting"], ["gone-number", "double-setting"], ["gone-string", "string-setting"]],
			);
		});
		it("should only use prototypes of the given scope", function() {
			const kept = new Map([["kept", { value: true }]]);
			const { known, unknown } = modSettingFields(prototypes, "runtime-global", kept);
			assert.deepEqual(known.map(field => field.name), ["map"]);
			assert.deepEqual(unknown.map(field => field.name), ["kept"]);
		});
		it("should not call settings unknown without export data", function() {
			const { known, unknown } = modSettingFields(undefined, "startup", stored);
			assert.deepEqual(known.map(field => field.name), [...stored.keys()]);
			assert(known.every(field => field.mod === undefined));
			assert.deepEqual(unknown, []);
		});
		it("should treat every stored setting as unknown if the export has no settings", function() {
			const { known, unknown } = modSettingFields({}, "startup", stored);
			assert.deepEqual(known, []);
			assert.equal(unknown.length, stored.size);
		});
	});
});
