import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import * as lib from "@clusterio/lib";
import { InstanceRecord } from "@clusterio/controller";
import * as mock from "../../../test/mock.js";
import controllerEntrypoint from "../dist/node/controller.js";
import { components as allComponents } from "../dist/node/components.js";
import { plugin as info } from "../dist/node/index.js";
import * as msg from "../dist/node/messages.js";

describe("player_sync controller", function() {
	const databaseDir = path.join("temp", "test", "player_sync");

	before(function() {
		try {
			lib.registerPluginMessages([info]);
		} catch (err) {
			// Already registered by the full test suite
		}
	});
	beforeEach(async function() {
		await fs.rm(databaseDir, { recursive: true, force: true });
		await fs.mkdir(databaseDir, { recursive: true });
	});

	async function load() {
		return await mock.loadControllerPlugin(async (context) => {
			context.controller.mockConfigEntries.set("controller.database_directory", databaseDir);
			await controllerEntrypoint(context);
		}, info);
	}

	it("should move inventories.json to player_sync.json", async function() { // Alpha 28
		const playerData = { name: "test", generation: 1 };
		await fs.writeFile(path.join(databaseDir, "inventories.json"), JSON.stringify([["test", playerData]]));

		const controller = await load();
		const stats = await mock.getHandler(controller, msg.DatabaseStatsRequest)();
		assert.equal(stats.databaseEntries, 1);
		assert.equal(stats.largestEntry.name, "test");
		await assert.rejects(fs.access(path.join(databaseDir, "inventories.json")), { code: "ENOENT" });
		await fs.access(path.join(databaseDir, "player_sync.json"));
	});
	it("should not replace an existing player_sync.json", async function() {
		await fs.writeFile(path.join(databaseDir, "inventories.json"), JSON.stringify([["old", { name: "old" }]]));
		await fs.writeFile(path.join(databaseDir, "player_sync.json"), JSON.stringify([["new", { name: "new" }]]));

		const controller = await load();
		const stats = await mock.getHandler(controller, msg.DatabaseStatsRequest)();
		assert.equal(stats.databaseEntries, 1);
		assert.equal(stats.largestEntry.name, "new");
	});

	describe("UploadRequest", function() {
		let controller;
		let disabled;
		beforeEach(async function() {
			disabled = [];
			const stored = { generation: 1, name: "test", force: "player", tag: "stored" };
			await fs.writeFile(path.join(databaseDir, "player_sync.json"), JSON.stringify([["test", stored]]));
			controller = await load();
			controller.instances = new Map([[1, {
				config: {
					get: name => {
						if (name === "instance.name") { return "test instance"; }
						return !disabled.includes(name.replace("player_sync.sync_", ""));
					},
				},
			}]]);
		});

		async function upload(playerData) {
			await mock.getHandler(controller, msg.UploadRequest)({ instanceId: 1, playerName: "test", playerData });
			return (await mock.getHandler(controller, msg.DownloadRequest)({ instanceId: 1, playerName: "test" }))
				.playerData;
		}

		it("should store the upload as is when it has no components", async function() {
			const playerData = { generation: 2, name: "test", force: "enemy", tag: "uploaded" };
			assert.deepEqual(await upload(playerData), playerData);
		});
		it("should merge by the payload's components and ignore the instance config", async function() {
			disabled = ["appearance"];
			const components = Object.fromEntries(Object.keys(allComponents).map(c => [c, c !== "force"]));
			assert.deepEqual(
				await upload({ generation: 2, name: "test", tag: "uploaded", components }),
				{ generation: 2, name: "test", force: "player", tag: "uploaded" },
			);
		});
	});

	describe("player data tools", function() {
		function playerData(name, generation, extra = {}) {
			return { generation, epoch: 0, name, controller: "character", force: "player", ...extra };
		}

		let controller;
		function handler(Class) {
			return mock.getHandler(controller, Class);
		}
		async function acquire(instanceId, playerName) {
			const response = await handler(msg.AcquireRequest)(new msg.AcquireRequest(instanceId, playerName));
			return response.status === "acquired";
		}
		async function saved() {
			await controller.hooks.save.invoke();
			return new Map(JSON.parse(await fs.readFile(path.join(databaseDir, "player_sync.json"), "utf8")));
		}
		async function upload(instanceId, data) {
			await handler(msg.UploadRequest)(new msg.UploadRequest(instanceId, data.name, data));
		}
		async function acquireResponse(instanceId, playerName) {
			return await handler(msg.AcquireRequest)(new msg.AcquireRequest(instanceId, playerName));
		}

		async function loadWithInstances() {
			controller = await mock.loadControllerPlugin(async (context) => {
				context.controller.mockConfigEntries.set("controller.database_directory", databaseDir);
				// Negative so locks expire as soon as their instance stops
				context.controller.mockConfigEntries.set("player_sync.player_lock_timeout", -1);
				await controllerEntrypoint(context);
			}, info);
			for (const [id, name, status] of [[1, "Running", "running"], [2, "Stopped", "stopped"]]) {
				controller.instances.records.set(id, new InstanceRecord(
					new lib.InstanceConfig("controller", { "instance.id": id, "instance.name": name }), status,
				));
			}
		}

		beforeEach(async function() {
			await loadWithInstances();

			await handler(msg.UploadRequest)(new msg.UploadRequest(1, "stored", playerData("stored", 3)));
			assert(await acquire(1, "stored"));
			assert(await acquire(1, "online"));
			assert(await acquire(2, "expired"));
			await controller.hooks.instanceStatusChanged.invoke(controller.instances.get(2), "running");
			assert(await acquire(99, "gone"));
			await saved();
		});

		describe("ListPlayersRequest", function() {
			it("should list stored data and live acquisitions", async function() {
				const entries = await handler(msg.ListPlayersRequest)(new msg.ListPlayersRequest());
				entries.sort((a, b) => a.name.localeCompare(b.name));
				assert.deepEqual(entries, [
					new msg.PlayerEntry("online", undefined, undefined, 1),
					new msg.PlayerEntry("stored", 3, JSON.stringify(playerData("stored", 3)).length, 1),
				]);
			});
		});

		describe("GetPlayerDataRequest", function() {
			async function get(name) {
				return await handler(msg.GetPlayerDataRequest)(new msg.GetPlayerDataRequest(name));
			}
			it("should return stored data and acquisition", async function() {
				assert.deepEqual(await get("stored"), new msg.GetPlayerDataResponse(playerData("stored", 3), 1));
			});
			it("should return null for unknown players", async function() {
				assert.deepEqual(await get("unknown"), new msg.GetPlayerDataResponse(null, undefined));
			});
			it("should ignore expired and dangling acquisitions", async function() {
				for (const name of ["expired", "gone"]) {
					assert.equal((await get(name)).instanceId, undefined);
				}
			});
		});

		const acquiredError = new lib.RequestError(
			"stored is currently acquired by Running, have the player leave or release the lock first"
		);

		describe("SetPlayerDataRequest", function() {
			async function set(name, data) {
				return await handler(msg.SetPlayerDataRequest)(new msg.SetPlayerDataRequest(name, data));
			}
			async function release(name) {
				await handler(msg.ForceReleaseRequest)(new msg.ForceReleaseRequest(name));
			}
			it("should store data with a bumped generation and epoch", async function() {
				await release("stored");
				assert.deepEqual(await set("stored", playerData("other", 1)), new msg.SetPlayerDataResponse(4));
				assert.deepEqual((await saved()).get("stored"), playerData("stored", 4, { epoch: 1 }));
			});
			it("should invalidate unconfirmed uploads from instances", async function() {
				// Instance 1 left with generation 4 but the upload never reached the controller
				await release("stored");
				await set("stored", playerData("stored", 0));
				await upload(1, playerData("stored", 4));
				assert.deepEqual((await saved()).get("stored"), playerData("stored", 4, { epoch: 1 }));
				assert.deepEqual(
					await acquireResponse(1, "stored"), new msg.AcquireResponse("acquired", 4, true, undefined, 1),
				);
			});
			it("should ignore the epoch in imported data", async function() {
				await release("stored");
				await set("stored", playerData("stored", 0, { epoch: 7 }));
				assert.equal((await saved()).get("stored").epoch, 1);
			});
			it("should keep a higher provided generation", async function() {
				await release("stored");
				assert.equal((await set("stored", playerData("stored", 10))).generation, 10);
			});
			it("should store data for new players", async function() {
				assert.equal((await set("new", playerData("new", 0))).generation, 1);
				assert.equal((await saved()).get("new").generation, 1);
			});
			it("should reject when the player is acquired", async function() {
				await assert.rejects(set("stored", playerData("stored", 3)), acquiredError);
				assert.equal((await saved()).get("stored").generation, 3);
			});

			// The link validates requests before the handler runs
			const fromJSON = lib.Link.requestFromJSON(msg.SetPlayerDataRequest, "SetPlayerDataRequest");
			async function setJSON(name, data) {
				const request = fromJSON({ playerName: name, playerData: data });
				return await handler(msg.SetPlayerDataRequest)(request);
			}
			it("should keep the stored data when an import fails validation", async function() {
				await release("stored");
				await setJSON("stored", playerData("stored", 0));
				const before = (await saved()).get("stored");
				assert.equal(before.epoch, 1);
				const badFilter = { value: { name: "iron-plate" }, min: "many" };
				for (const extra of [
					{ crafting_queue: {} },
					{ deleted: false },
					{ deleted: true },
					{ controller: "cutscene" },
					{ inventories: { main: { i: [{ e: null }] } } },
					{ personal_logistic_slots: {
						enabled: true,
						trash_not_requested: false,
						sections: [{ group: "", active: true, multiplier: 1, filters: [badFilter] }],
					} },
				]) {
					await assert.rejects(
						setJSON("stored", playerData("stored", 0, extra)),
						{ message: "Request SetPlayerDataRequest failed validation" },
					);
				}
				assert.deepEqual((await saved()).get("stored"), before);
			});
			it("should start over from imported generations past the limit", async function() {
				await release("stored");
				assert.equal((await setJSON("stored", playerData("stored", 2 ** 53))).generation, 4);
				await upload(1, playerData("stored", 5, { epoch: 1 }));
				assert.deepEqual((await saved()).get("stored"), playerData("stored", 5, { epoch: 1 }));
			});
			for (const deleted of [false, true]) {
				it(`should recover ${deleted ? "deleted" : "stored"} data past the generation limit`, async function() {
					// Could be stored by uploads or by imports from before the limit
					for (const generation of [msg.generationLimit, 2 ** 53]) {
						const stuck = { ...playerData("stored", generation), ...deleted ? { deleted } : {} };
						const entries = [["stored", stuck]];
						await fs.writeFile(path.join(databaseDir, "player_sync.json"), JSON.stringify(entries));
						await loadWithInstances();
						// Importing the exported data as is
						assert.equal((await setJSON("stored", playerData("stored", generation))).generation, 1);
						await upload(1, playerData("stored", 2, { epoch: 1 }));
						assert.deepEqual((await saved()).get("stored"), playerData("stored", 2, { epoch: 1 }));
					}
				});
			}
			it("should keep counting up below the generation limit", async function() {
				const stored = playerData("stored", msg.generationLimit - 1);
				await fs.writeFile(path.join(databaseDir, "player_sync.json"), JSON.stringify([["stored", stored]]));
				await loadWithInstances();
				const response = await setJSON("stored", playerData("stored", 0));
				assert.equal(response.generation, msg.generationLimit);
			});
			it("should only load entries marked deleted: true as tombstones", async function() {
				// Imports from before the marker was reserved could store deleted: false
				const data = playerData("stored", 4, { epoch: 1 });
				const entries = [["stored", { ...data, deleted: false }]];
				await fs.writeFile(path.join(databaseDir, "player_sync.json"), JSON.stringify(entries));
				controller = await load();
				const response = await handler(msg.GetPlayerDataRequest)(new msg.GetPlayerDataRequest("stored"));
				assert.deepEqual(response.playerData, data);
			});
		});

		describe("DeletePlayerDataRequest", function() {
			async function del(name) {
				await handler(msg.DeletePlayerDataRequest)(new msg.DeletePlayerDataRequest(name));
			}
			it("should delete stored data", async function() {
				await handler(msg.ForceReleaseRequest)(new msg.ForceReleaseRequest("stored"));
				await del("stored");
				const response = await handler(msg.GetPlayerDataRequest)(new msg.GetPlayerDataRequest("stored"));
				assert.equal(response.playerData, null);
			});
			it("should keep the generation and bump the epoch", async function() {
				await handler(msg.ForceReleaseRequest)(new msg.ForceReleaseRequest("stored"));
				await del("stored");
				assert.deepEqual(
					await acquireResponse(2, "stored"), new msg.AcquireResponse("acquired", 3, false, undefined, 1),
				);
				// In the same file as the player data so the delete and its tombstone are written together
				assert.deepEqual((await saved()).get("stored"), { generation: 3, epoch: 1, deleted: true });

				controller = await load();
				assert.deepEqual(
					await acquireResponse(2, "stored"), new msg.AcquireResponse("acquired", 3, false, undefined, 1),
				);
			});
			it("should accept the next upload from the new epoch only", async function() {
				await handler(msg.ForceReleaseRequest)(new msg.ForceReleaseRequest("stored"));
				await del("stored");
				await upload(1, playerData("stored", 11));
				assert((await saved()).get("stored").deleted);
				await upload(2, playerData("stored", 4, { epoch: 1 }));
				assert.deepEqual((await saved()).get("stored"), playerData("stored", 4, { epoch: 1 }));

				// The other instance downloads the baseline instead of uploading its stale copy
				await upload(1, playerData("stored", 11));
				assert.equal((await saved()).get("stored").generation, 4);
			});
			it("should reject unknown players", async function() {
				await assert.rejects(del("unknown"), new lib.RequestError("No player data stored for unknown"));
			});
			it("should reject when the player is acquired", async function() {
				await assert.rejects(del("stored"), acquiredError);
				assert.deepEqual((await saved()).get("stored"), playerData("stored", 3));
			});
		});

		describe("uploads without an epoch", function() {
			// What instances running a version from before epochs send
			function legacyData(generation) {
				const data = playerData("stored", generation);
				delete data.epoch;
				return data;
			}
			beforeEach(async function() {
				await handler(msg.ForceReleaseRequest)(new msg.ForceReleaseRequest("stored"));
			});
			it("should store them by generation", async function() {
				await upload(1, legacyData(3));
				await upload(1, legacyData(4));
				assert.deepEqual((await saved()).get("stored"), legacyData(4));
			});
			it("should keep accepting them after an import", async function() {
				const request = new msg.SetPlayerDataRequest("stored", playerData("stored", 0));
				await handler(msg.SetPlayerDataRequest)(request);
				await upload(1, legacyData(4));
				assert.equal((await saved()).get("stored").epoch, 1);
				await upload(1, legacyData(5));
				assert.deepEqual((await saved()).get("stored"), playerData("stored", 5, { epoch: 1 }));
			});
			it("should accept any generation after a delete", async function() {
				await handler(msg.DeletePlayerDataRequest)(new msg.DeletePlayerDataRequest("stored"));
				await upload(1, legacyData(1));
				assert.deepEqual((await saved()).get("stored"), playerData("stored", 1, { epoch: 1 }));
			});
		});

		describe("ForceReleaseRequest", function() {
			async function release(name) {
				await handler(msg.ForceReleaseRequest)(new msg.ForceReleaseRequest(name));
			}
			it("should remove the acquisition", async function() {
				await release("online");
				assert(await acquire(2, "online"));
			});
			it("should reject players that are not acquired", async function() {
				await assert.rejects(
					release("unknown"), new lib.RequestError("unknown is not acquired by any instance"),
				);
			});
		});

		describe("AcquireRequest", function() {
			it("should refuse players held by another instance", async function() {
				assert(!await acquire(2, "online"));
				assert(await acquire(1, "online"));
			});
			it("should take over expired and dangling acquisitions", async function() {
				assert(await acquire(1, "expired"));
				assert(await acquire(1, "gone"));
				const response = await handler(msg.GetPlayerDataRequest)(new msg.GetPlayerDataRequest("gone"));
				assert.equal(response.instanceId, 1);
			});
		});
	});
});
