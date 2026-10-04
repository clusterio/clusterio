import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import * as mock from "../../../test/mock.js";
import { ControllerPlugin } from "../dist/node/controller.js";
import { plugin as info } from "../dist/node/index.js";

describe("inventory_sync ControllerPlugin", function() {
	let controllerPlugin;
	let disabled;
	before(async function() {
		const controller = new mock.MockController();
		controller.mockConfigEntries.set(
			"controller.database_directory", path.join(os.tmpdir(), "inventory_sync_test_missing")
		);
		controller.instances = new Map([[1, {
			config: {
				get: name => {
					if (name === "instance.name") { return "test instance"; }
					return !disabled.includes(name.replace("inventory_sync.sync_", ""));
				},
			},
		}]]);
		controllerPlugin = new ControllerPlugin(info, controller, {}, new mock.MockLogger());
		await controllerPlugin.init();
	});
	beforeEach(function() {
		disabled = [];
		controllerPlugin.playerDatastore = new Map([
			["test", { generation: 1, name: "test", force: "player", tag: "stored" }],
		]);
	});

	describe(".handleUploadRequest()", function() {
		it("should store the upload as is when everything is synced", async function() {
			const playerData = { generation: 2, name: "test", force: "enemy", tag: "uploaded" };
			await controllerPlugin.handleUploadRequest({ instanceId: 1, playerName: "test", playerData });
			assert.deepEqual(controllerPlugin.playerDatastore.get("test"), playerData);
		});
		it("should keep stored fields the uploading instance does not sync", async function() {
			disabled = ["force"];
			const playerData = { generation: 2, name: "test", tag: "uploaded" };
			await controllerPlugin.handleUploadRequest({ instanceId: 1, playerName: "test", playerData });
			assert.deepEqual(
				controllerPlugin.playerDatastore.get("test"),
				{ generation: 2, name: "test", force: "player", tag: "uploaded" },
			);
		});
	});
});
