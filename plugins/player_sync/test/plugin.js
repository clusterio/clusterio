import assert from "node:assert/strict";

import { testRoundTripJsonSerialisable, testMatrix } from "../../../test/common.js";
import * as msg from "../dist/node/messages.js";
import { summarizeInventory, summarizePlayerInventories } from "../dist/node/player_data.js";


function playerData(name, generation, extra = {}) {
	return { generation, name, controller: "character", force: "player", ...extra };
}

describe("player_sync plugin", function() {
	describe("messages", function() {
		it("PlayerEntry should be round trip json serialisable", function() {
			testRoundTripJsonSerialisable(msg.PlayerEntry, testMatrix(
				["player"], // name
				[undefined, 0, 4], // generation
				[undefined, 0, 1234], // size
				[undefined, 1], // instanceId
			));
		});
		it("GetPlayerDataResponse should be round trip json serialisable", function() {
			testRoundTripJsonSerialisable(msg.GetPlayerDataResponse, testMatrix(
				[null, playerData("player", 1)], // playerData
				[undefined, 1], // instanceId
			));
		});
		it("SetPlayerDataResponse should be round trip json serialisable", function() {
			testRoundTripJsonSerialisable(msg.SetPlayerDataResponse, testMatrix([1, 5]));
		});
		it("requests should be round trip json serialisable", function() {
			testRoundTripJsonSerialisable(msg.GetPlayerDataRequest, testMatrix(["player"]));
			testRoundTripJsonSerialisable(msg.DeletePlayerDataRequest, testMatrix(["player"]));
			testRoundTripJsonSerialisable(msg.ForceReleaseRequest, testMatrix(["player"]));
			testRoundTripJsonSerialisable(msg.SetPlayerDataRequest, testMatrix(
				["player"], // playerName
				[playerData("player", 3)], // playerData
			));
		});
	});

	describe("summarizeInventory()", function() {
		it("should merge stacks and expand repeats", function() {
			assert.deepEqual(summarizeInventory({ i: [
				{ n: "iron-plate", c: 100, r: 2 },
				{ n: "iron-plate", c: 50, q: "rare" },
				{ n: "iron-plate", c: 7, s: 10 },
				{ e: "0eNq", r: 1 },
				{ f: "copper-plate" },
			] }), [
				{ name: "iron-plate", quality: undefined, count: 307 },
				{ name: "iron-plate", quality: "rare", count: 50 },
				{ name: "exported item", count: 1, exportSize: 4 },
				{ name: "exported item", count: 1, exportSize: 4 },
			]);
		});
		it("should handle empty inventories", function() {
			assert.deepEqual(summarizeInventory({}), []);
		});
	});

	describe("summarizePlayerInventories()", function() {
		it("should prefer character inventories", function() {
			const data = playerData("player", 1, {
				character: { inventories: { main: { i: [{ n: "wood", c: 1 }] } } },
				inventories: { main: { i: [{ n: "stone", c: 1 }] } },
			});
			assert.deepEqual(summarizePlayerInventories(data), [
				{ name: "main", items: [{ name: "wood", quality: undefined, count: 1 }] },
			]);
		});
		it("should fall back to player inventories", function() {
			const data = playerData("player", 1, { inventories: { main: { i: [{ n: "stone", c: 1 }] } } });
			assert.deepEqual(summarizePlayerInventories(data), [
				{ name: "main", items: [{ name: "stone", quality: undefined, count: 1 }] },
			]);
		});
		it("should handle missing inventories", function() {
			assert.deepEqual(summarizePlayerInventories(playerData("player", 1)), []);
		});
	});
});
