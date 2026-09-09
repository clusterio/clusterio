"use strict";
const assert = require("assert").strict;
const util = require("util");
const zlib = require("zlib");

const { recipeNotificationDelta, InstancePlugin } = require("../dist/node/instance");

const inflate = util.promisify(zlib.inflate);
const deflate = util.promisify(zlib.deflate);

// Matches helpers.encode_string in Factorio
async function encode(value) {
	return (await deflate(Buffer.from(JSON.stringify(value)))).toString("base64");
}
async function decode(encoded) {
	return JSON.parse((await inflate(Buffer.from(encoded, "base64"))).toString());
}

describe("inventory_sync", function() {
	describe("recipeNotificationDelta()", function() {
		it("should be empty when the lists match", function() {
			assert.deepEqual(recipeNotificationDelta(["a", "b"], ["b", "a"]), {});
		});
		it("should add stored names missing from current", function() {
			assert.deepEqual(recipeNotificationDelta(["a", "b", "c"], ["a"]), { add: ["b", "c"] });
		});
		it("should remove current names missing from stored", function() {
			assert.deepEqual(recipeNotificationDelta(["a"], ["a", "b"]), { remove: ["b"] });
		});
		it("should handle both directions at once", function() {
			assert.deepEqual(recipeNotificationDelta(["a", "b"], ["b", "c"]), { add: ["a"], remove: ["c"] });
		});
		it("should keep duplicates in stored out of the current list", function() {
			assert.deepEqual(recipeNotificationDelta(["a", "a"], ["a"]), {});
		});
	});

	describe("InstancePlugin.applyRecipeNotificationDelta()", function() {
		const warnings = [];
		const plugin = { logger: { warn: msg => warnings.push(msg) } };
		const apply = InstancePlugin.prototype.applyRecipeNotificationDelta.bind(plugin);

		it("should replace the stored list with an encoded delta", async function() {
			const playerData = { name: "test", recipe_notifications: await encode(["a", "b"]) };
			await apply(playerData, await encode(["b", "c"]));
			assert.equal(playerData.recipe_notifications, undefined);
			assert.deepEqual(await decode(playerData.recipe_notifications_delta), { add: ["a"], remove: ["c"] });
		});
		it("should send an empty delta when nothing changed", async function() {
			const playerData = { name: "test", recipe_notifications: await encode(["a"]) };
			await apply(playerData, await encode(["a"]));
			assert.deepEqual(await decode(playerData.recipe_notifications_delta), {});
		});
		it("should do nothing without stored notifications", async function() {
			const playerData = { name: "test" };
			await apply(playerData, await encode(["a"]));
			assert.deepEqual(playerData, { name: "test" });
		});
		it("should fall back to the full list on invalid input", async function() {
			const stored = await encode(["a"]);
			const playerData = { name: "test", recipe_notifications: stored };
			await apply(playerData, "not base64 zlib");
			assert.equal(playerData.recipe_notifications, stored);
			assert.equal(playerData.recipe_notifications_delta, undefined);
			assert.equal(warnings.length, 1);
		});
	});
});
