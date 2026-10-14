import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import * as lib from "@clusterio/lib";
import * as mock from "../../../test/mock.js";
import controllerEntrypoint from "../dist/node/controller.js";
import { plugin as info } from "../dist/node/index.js";
import { DatabaseStatsRequest } from "../dist/node/messages.js";

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
});
