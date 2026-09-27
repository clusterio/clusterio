import assert from "node:assert/strict";

import { components, enabledComponents, mergePlayerData, stripPlayerData } from "../dist/node/components.js";

const allComponents = Object.keys(components);

function configWith(disabled = []) {
	return { get: name => !disabled.includes(name.replace("inventory_sync.sync_", "")) };
}

const character = { inventories: { main: [] } };
const stored = {
	generation: 1,
	name: "test",
	controller: "god",
	cheat_mode: true,
	force: "player",
	color: [1, 0, 0],
	chat_color: [1, 0, 0],
	tag: "stored",
	inventories: { main: ["stored god item"] },
	quick_bar: ["stored-item"],
	recipe_notifications: "stored",
};
const uploaded = {
	generation: 2,
	name: "test",
	controller: "character",
	cheat_mode: false,
	force: "enemy",
	color: [0, 1, 0],
	chat_color: [0, 1, 0],
	tag: "uploaded",
	character,
	crafting_queue: [],
	personal_logistic_slots: [],
	quick_bar: ["uploaded-item"],
	recipe_notifications: "uploaded",
};

describe("inventory_sync components", function() {
	describe("enabledComponents()", function() {
		it("should enable every component by default", function() {
			assert.deepEqual([...enabledComponents(configWith())], allComponents);
		});
		it("should leave out disabled components", function() {
			const enabled = enabledComponents(configWith(["force", "quick_bar"]));
			assert.equal(enabled.has("force"), false);
			assert.equal(enabled.has("quick_bar"), false);
			assert.equal(enabled.size, allComponents.length - 2);
		});
		it("should not sync the controller without the inventories", function() {
			const enabled = enabledComponents(configWith(["inventories"]));
			assert.equal(enabled.has("controller"), false);
		});
	});

	describe("stripPlayerData()", function() {
		it("should keep everything when all components are synced", function() {
			const playerData = structuredClone(uploaded);
			stripPlayerData(playerData, new Set(allComponents));
			assert.deepEqual(playerData, uploaded);
		});
		it("should remove the fields of disabled components", function() {
			const playerData = structuredClone(uploaded);
			stripPlayerData(playerData, new Set(allComponents.filter(c => !["appearance", "inventories"].includes(c))));
			for (const key of ["color", "chat_color", "tag", "character", "crafting_queue"]) {
				assert.equal(key in playerData, false, key);
			}
			assert.equal(playerData.force, "enemy");
		});
	});

	describe("mergePlayerData()", function() {
		it("should store the upload as is when all components are synced", function() {
			assert.deepEqual(mergePlayerData(stored, uploaded, new Set(allComponents)), uploaded);
		});
		it("should keep the stored fields of disabled components", function() {
			const enabled = new Set(allComponents.filter(c => !["force", "appearance"].includes(c)));
			const merged = mergePlayerData(stored, uploaded, enabled);
			assert.equal(merged.force, "player");
			assert.deepEqual(merged.color, [1, 0, 0]);
			assert.equal(merged.tag, "stored");
			assert.deepEqual(merged.quick_bar, ["uploaded-item"]);
			assert.equal(merged.generation, 2);
		});
		it("should drop disabled components without stored data", function() {
			const merged = mergePlayerData(undefined, uploaded, new Set(allComponents.filter(c => c !== "force")));
			assert.equal("force" in merged, false);
			assert.equal(merged.tag, "uploaded");
		});
		it("should take the character but not the controller when the controller is not synced", function() {
			const merged = mergePlayerData(stored, uploaded, new Set(allComponents.filter(c => c !== "controller")));
			assert.equal(merged.controller, "god");
			assert.equal(merged.cheat_mode, true);
			assert.equal(merged.character, character);
			assert.deepEqual(merged.inventories, { main: ["stored god item"] }, "god inventory is kept");
		});
		it("should keep the character data for a player without one when the controller is not synced", function() {
			const storedCharacter = { ...stored, character, crafting_queue: ["stored"], personal_logistic_slots: [] };
			const god = { ...uploaded, controller: "god", inventories: { main: ["new god item"] } };
			delete god.character;
			delete god.crafting_queue;
			delete god.personal_logistic_slots;
			const enabled = new Set(allComponents.filter(c => c !== "controller"));
			const merged = mergePlayerData(storedCharacter, god, enabled);
			assert.equal(merged.character, character);
			assert.deepEqual(merged.crafting_queue, ["stored"]);
			assert.deepEqual(merged.inventories, { main: ["stored god item"] });
		});
	});
});
