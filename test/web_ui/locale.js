import assert from "node:assert/strict";

import {
	modSettingDescription, modSettingName, modSettingValueName, resolveLocalisedString, stripRichText,
} from "../../packages/web_ui/src/util/locale.ts";

describe("web_ui/util/locale", function() {
	const locale = new Map([
		["phi-cl.combine", "__1__ __2__"],
		["mod-setting-name-prefix.PHI-MB", "[color=255,254,42]MB[/color]"],
		["mod-setting-name.PHI-MB", "[color=255,254,42]Enable better entity[/color]"],
		["mod-setting-name.plain", "Plain setting"],
		["mod-setting-description.plain", "Plain description"],
		["string-mod-setting.mode-fast", "[font=default-bold]Fast[/font]"],
		["item-name.iron-plate", "Iron plate"],
		["entity-name.inserter", "Inserter"],
		["uses", "Uses __ITEM__iron-plate__ and __ENTITY__inserter__"],
		["greeting", "Hello __1__"],
	]);

	describe("resolveLocalisedString()", function() {
		it("should return plain strings and numbers as is", function() {
			assert.equal(resolveLocalisedString(locale, "text"), "text");
			assert.equal(resolveLocalisedString(locale, 5), "5");
		});
		it("should substitute parameters", function() {
			assert.equal(resolveLocalisedString(locale, ["greeting", "world"]), "Hello world");
			assert.equal(resolveLocalisedString(locale, ["greeting", ["greeting", 2]]), "Hello Hello 2");
		});
		it("should leave parameters that were not given", function() {
			assert.equal(resolveLocalisedString(locale, ["greeting"]), "Hello __1__");
		});
		it("should substitute prototype names", function() {
			assert.equal(resolveLocalisedString(locale, ["uses"]), "Uses Iron plate and Inserter");
		});
		it("should concatenate with an empty key", function() {
			assert.equal(resolveLocalisedString(locale, ["", "a", ["greeting", "b"], 3]), "aHello b3");
		});
		it("should use the first alternative that resolves with a ? key", function() {
			assert.equal(resolveLocalisedString(locale, ["?", ["missing"], ["greeting", "x"], "y"]), "Hello x");
			assert.equal(resolveLocalisedString(locale, ["?", ["missing"]]), undefined);
		});
		it("should return undefined if a key is missing", function() {
			assert.equal(resolveLocalisedString(locale, ["missing"]), undefined);
			assert.equal(resolveLocalisedString(locale, ["greeting", ["missing"]]), undefined);
		});
		it("should return undefined for nesting that is too deep", function() {
			let value = "end";
			for (let i = 0; i < 30; i++) {
				value = ["", value];
			}
			assert.equal(resolveLocalisedString(locale, value), undefined);
		});
	});

	describe("stripRichText()", function() {
		it("should remove formatting tags", function() {
			assert.equal(stripRichText(locale, "[color=red]A[/color] [font=default-bold]B[/font]"), "A B");
		});
		it("should replace prototype icons with their name", function() {
			assert.equal(stripRichText(locale, "[item=iron-plate] plates"), "Iron plate plates");
			assert.equal(stripRichText(locale, "[item=iron-plate,quality=rare]"), "Iron plate");
			assert.equal(stripRichText(locale, "[fluid=unknown]"), "unknown");
		});
		it("should remove other icons", function() {
			assert.equal(stripRichText(locale, "[img=utility/warning_icon] Warning"), "Warning");
		});
		it("should keep brackets that are not tags", function() {
			assert.equal(stripRichText(locale, "[Beta] [x=1]"), "[Beta] [x=1]");
		});
	});

	describe("modSettingName()", function() {
		it("should resolve localised_name", function() {
			const prototype = {
				name: "PHI-MB",
				localised_name: ["phi-cl.combine", ["mod-setting-name-prefix.PHI-MB"], ["mod-setting-name.PHI-MB"]],
			};
			assert.equal(modSettingName(locale, prototype), "MB Enable better entity");
		});
		it("should fall back to the mod-setting-name key", function() {
			assert.equal(modSettingName(locale, { name: "plain" }), "Plain setting");
			assert.equal(modSettingName(locale, { name: "plain", localised_name: ["missing"] }), "Plain setting");
		});
		it("should fall back to the internal name", function() {
			assert.equal(modSettingName(locale, { name: "other" }), "other");
			assert.equal(modSettingName(new Map(), { name: "plain" }), "plain");
		});
	});

	describe("modSettingDescription()", function() {
		it("should resolve localised_description", function() {
			const prototype = { name: "plain", localised_description: ["greeting", "desc"] };
			assert.equal(modSettingDescription(locale, prototype), "Hello desc");
		});
		it("should fall back to the mod-setting-description key", function() {
			assert.equal(modSettingDescription(locale, { name: "plain" }), "Plain description");
		});
		it("should return undefined without a description", function() {
			assert.equal(modSettingDescription(locale, { name: "other" }), undefined);
		});
	});

	describe("modSettingValueName()", function() {
		it("should resolve the string-mod-setting key", function() {
			assert.equal(modSettingValueName(locale, "mode", "fast"), "Fast");
		});
		it("should fall back to the value", function() {
			assert.equal(modSettingValueName(locale, "mode", "slow"), "slow");
			assert.equal(modSettingValueName(locale, "mode", 3), "3");
		});
	});
});
