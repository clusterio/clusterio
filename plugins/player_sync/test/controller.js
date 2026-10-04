import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import * as lib from "@clusterio/lib";
import * as mock from "../../../test/mock.js";
import controllerEntrypoint from "../dist/node/controller.js";
import { plugin as info } from "../dist/node/index.js";
import { DatabaseStatsRequest, DownloadRequest, UploadRequest } from "../dist/node/messages.js";

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
		const stats = await mock.getHandler(controller, DatabaseStatsRequest)();
		assert.equal(stats.databaseEntries, 1);
		assert.equal(stats.largestEntry.name, "test");
		await assert.rejects(fs.access(path.join(databaseDir, "inventories.json")), { code: "ENOENT" });
		await fs.access(path.join(databaseDir, "player_sync.json"));
	});
	it("should not replace an existing player_sync.json", async function() {
		await fs.writeFile(path.join(databaseDir, "inventories.json"), JSON.stringify([["old", { name: "old" }]]));
		await fs.writeFile(path.join(databaseDir, "player_sync.json"), JSON.stringify([["new", { name: "new" }]]));

		const controller = await load();
		const stats = await mock.getHandler(controller, DatabaseStatsRequest)();
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
			await mock.getHandler(controller, UploadRequest)({ instanceId: 1, playerName: "test", playerData });
			return (await mock.getHandler(controller, DownloadRequest)({ instanceId: 1, playerName: "test" }))
				.playerData;
		}

		it("should store the upload as is when everything is synced", async function() {
			const playerData = { generation: 2, name: "test", force: "enemy", tag: "uploaded" };
			assert.deepEqual(await upload(playerData), playerData);
		});
		it("should keep stored fields the uploading instance does not sync", async function() {
			disabled = ["force"];
			assert.deepEqual(
				await upload({ generation: 2, name: "test", tag: "uploaded" }),
				{ generation: 2, name: "test", force: "player", tag: "uploaded" },
			);
		});
	});
});
