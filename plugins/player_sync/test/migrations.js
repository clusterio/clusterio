import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as lib from "@clusterio/lib";
import { Controller } from "@clusterio/controller";

import { plugin as info } from "../dist/node/index.js";

describe("player_sync migrations", function() {
	before(async function() {
		lib.addPluginConfigFields([info]);
		const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
		await lib.loadPluginMigrations([{ ...info, packagePath }]);
	});
	after(function() {
		for (const hook of [
			lib.ControllerConfig.pluginMigrations, lib.HostConfig.pluginMigrations,
			lib.InstanceConfig.pluginMigrations, lib.Role.pluginMigrations,
		]) {
			hook.detach(info.name);
		}
	});

	it("should rename inventory_sync config fields", function() { // Alpha 28
		const controllerConfig = lib.ControllerConfig.fromJSON({
			"inventory_sync.load_plugin": false,
			"inventory_sync.player_lock_timeout": 120,
		}, "controller");
		assert.equal(controllerConfig.get("player_sync.load_plugin"), false);
		assert.equal(controllerConfig.get("player_sync.player_lock_timeout"), 120);
		assert.equal(controllerConfig.toJSON()["inventory_sync.player_lock_timeout"], undefined);

		const hostConfig = lib.HostConfig.fromJSON({ "inventory_sync.load_plugin": false }, "host");
		assert.equal(hostConfig.get("player_sync.load_plugin"), false);

		const instanceConfig = lib.InstanceConfig.fromJSON({
			"inventory_sync.rcon_chunk_size": 500,
		}, "controller");
		assert.equal(instanceConfig.get("player_sync.rcon_chunk_size"), 500);
	});
	it("should rename the inventory_sync permission in roles", function() { // Alpha 28
		const result = Controller.migrateRoles([
			{ permissions: ["core.admin", "inventory_sync.inventory.view"] },
		]);
		assert.deepEqual(result, [{ permissions: ["core.admin", "player_sync.inventory.view"] }]);
	});
});
