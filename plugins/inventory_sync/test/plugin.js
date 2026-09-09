"use strict";
const assert = require("assert").strict;
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const lib = require("@clusterio/lib");
const { InstanceRecord } = require("@clusterio/controller");

const mock = require("../../../test/mock");
const { testRoundTripJsonSerialisable, testMatrix } = require("../../../test/common");
const controller = require("../dist/node/controller");
const info = require("../dist/node/index").plugin;
const msg = require("../dist/node/messages");
const { summarizeInventory, summarizePlayerInventories } = require("../dist/node/player_data");


function playerData(name, generation, extra = {}) {
	return { generation, name, controller: "character", force: "player", ...extra };
}

describe("inventory_sync plugin", function() {
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

	describe("class ControllerPlugin", function() {
		let controllerPlugin;
		let databaseDir;
		before(async function() {
			databaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "inventory_sync-"));
			const mockController = new mock.MockController();
			mockController.mockConfigEntries.set("controller.database_directory", databaseDir);
			mockController.mockConfigEntries.set("inventory_sync.player_lock_timeout", 60);
			for (const [id, name] of [[1, "Running"], [2, "Stopped"]]) {
				mockController.instances.records.set(id, new InstanceRecord(
					new lib.InstanceConfig("controller", { "instance.id": id, "instance.name": name }), "running",
				));
			}
			controllerPlugin = new controller.ControllerPlugin(info, mockController, {}, new mock.MockLogger());
			await controllerPlugin.init();
		});
		after(async function() {
			await fs.rm(databaseDir, { recursive: true, force: true });
		});
		beforeEach(function() {
			controllerPlugin.acquiredPlayers.clear();
			controllerPlugin.playerDatastore.clear();
			controllerPlugin.playerDatastoreDirty = false;
			controllerPlugin.playerDatastore.set("stored", playerData("stored", 3));
			controllerPlugin.acquiredPlayers.set("stored", { instanceId: 1 });
			controllerPlugin.acquiredPlayers.set("online", { instanceId: 1 });
			controllerPlugin.acquiredPlayers.set("expired", { instanceId: 2, expiresMs: Date.now() - 1000 });
			controllerPlugin.acquiredPlayers.set("gone", { instanceId: 99 });
		});

		describe(".handleListPlayersRequest()", function() {
			it("should list stored data and live acquisitions", async function() {
				const entries = await controllerPlugin.handleListPlayersRequest();
				entries.sort((a, b) => a.name.localeCompare(b.name));
				assert.deepEqual(entries, [
					new msg.PlayerEntry("online", undefined, undefined, 1),
					new msg.PlayerEntry(
						"stored", 3, JSON.stringify(controllerPlugin.playerDatastore.get("stored")).length, 1
					),
				]);
			});
		});

		describe(".handleGetPlayerDataRequest()", function() {
			it("should return stored data and acquisition", async function() {
				const response = await controllerPlugin.handleGetPlayerDataRequest(
					new msg.GetPlayerDataRequest("stored")
				);
				assert.deepEqual(response, new msg.GetPlayerDataResponse(playerData("stored", 3), 1));
			});
			it("should return null for unknown players", async function() {
				const response = await controllerPlugin.handleGetPlayerDataRequest(
					new msg.GetPlayerDataRequest("unknown")
				);
				assert.deepEqual(response, new msg.GetPlayerDataResponse(null, undefined));
			});
			it("should ignore expired and dangling acquisitions", async function() {
				for (const name of ["expired", "gone"]) {
					const response = await controllerPlugin.handleGetPlayerDataRequest(
						new msg.GetPlayerDataRequest(name)
					);
					assert.equal(response.instanceId, undefined);
				}
			});
		});

		describe(".handleSetPlayerDataRequest()", function() {
			it("should store data with a bumped generation", async function() {
				controllerPlugin.acquiredPlayers.delete("stored");
				const response = await controllerPlugin.handleSetPlayerDataRequest(
					new msg.SetPlayerDataRequest("stored", playerData("other", 1))
				);
				assert.deepEqual(response, new msg.SetPlayerDataResponse(4));
				assert.deepEqual(controllerPlugin.playerDatastore.get("stored"), playerData("stored", 4));
				assert(controllerPlugin.playerDatastoreDirty);
			});
			it("should keep a higher provided generation", async function() {
				controllerPlugin.acquiredPlayers.delete("stored");
				const response = await controllerPlugin.handleSetPlayerDataRequest(
					new msg.SetPlayerDataRequest("stored", playerData("stored", 10))
				);
				assert.equal(response.generation, 10);
			});
			it("should store data for new players", async function() {
				const response = await controllerPlugin.handleSetPlayerDataRequest(
					new msg.SetPlayerDataRequest("new", playerData("new", 0))
				);
				assert.equal(response.generation, 1);
				assert.equal(controllerPlugin.playerDatastore.get("new").generation, 1);
			});
			it("should reject when the player is acquired", async function() {
				await assert.rejects(
					controllerPlugin.handleSetPlayerDataRequest(
						new msg.SetPlayerDataRequest("stored", playerData("stored", 3))
					),
					new lib.RequestError(
						"stored is currently acquired by Running, have the player leave or release the lock first"
					),
				);
				assert.equal(controllerPlugin.playerDatastore.get("stored").generation, 3);
			});
		});

		describe(".handleDeletePlayerDataRequest()", function() {
			it("should delete stored data", async function() {
				controllerPlugin.acquiredPlayers.delete("stored");
				await controllerPlugin.handleDeletePlayerDataRequest(new msg.DeletePlayerDataRequest("stored"));
				assert(!controllerPlugin.playerDatastore.has("stored"));
				assert(controllerPlugin.playerDatastoreDirty);
			});
			it("should reject unknown players", async function() {
				await assert.rejects(
					controllerPlugin.handleDeletePlayerDataRequest(new msg.DeletePlayerDataRequest("unknown")),
					new lib.RequestError("No player data stored for unknown"),
				);
			});
			it("should reject when the player is acquired", async function() {
				await assert.rejects(
					controllerPlugin.handleDeletePlayerDataRequest(new msg.DeletePlayerDataRequest("stored")),
					new lib.RequestError(
						"stored is currently acquired by Running, have the player leave or release the lock first"
					),
				);
				assert(controllerPlugin.playerDatastore.has("stored"));
			});
		});

		describe(".handleForceReleaseRequest()", function() {
			it("should remove the acquisition", async function() {
				await controllerPlugin.handleForceReleaseRequest(new msg.ForceReleaseRequest("online"));
				assert(!controllerPlugin.acquiredPlayers.has("online"));
				assert(controllerPlugin.acquire(2, "online"));
			});
			it("should reject players that are not acquired", async function() {
				await assert.rejects(
					controllerPlugin.handleForceReleaseRequest(new msg.ForceReleaseRequest("unknown")),
					new lib.RequestError("unknown is not acquired by any instance"),
				);
			});
		});

		describe(".acquire()", function() {
			it("should refuse players held by another instance", function() {
				assert(!controllerPlugin.acquire(2, "online"));
				assert(controllerPlugin.acquire(1, "online"));
			});
			it("should take over expired and dangling acquisitions", function() {
				assert(controllerPlugin.acquire(1, "expired"));
				assert(controllerPlugin.acquire(1, "gone"));
				assert.deepEqual(controllerPlugin.acquiredPlayers.get("gone"), { instanceId: 1 });
			});
		});
	});
});
