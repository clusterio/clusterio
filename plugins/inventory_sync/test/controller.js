import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import * as mock from "../../../test/mock.js";
import loadControllerPlugin from "../dist/node/controller.js";
import { components as allComponents } from "../dist/node/components.js";
import { DownloadRequest, UploadRequest } from "../dist/node/messages.js";
import { plugin as info } from "../dist/node/index.js";

describe("inventory_sync controller", function() {
	let upload;
	let download;
	let disabled;
	beforeEach(async function() {
		disabled = [];
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
		await loadControllerPlugin({ controller, metrics: {}, logger: new mock.MockLogger(), plugin: info });
		upload = playerData => mock.getHandler(controller, UploadRequest)(
			{ instanceId: 1, playerName: "test", playerData }
		);
		download = async () => (await mock.getHandler(controller, DownloadRequest)(
			{ instanceId: 1, playerName: "test" }
		)).playerData;
		await upload({ generation: 1, name: "test", force: "player", tag: "stored" });
	});

	describe("UploadRequest", function() {
		it("should store the upload as is when it has no components", async function() {
			const playerData = { generation: 2, name: "test", force: "enemy", tag: "uploaded" };
			await upload(playerData);
			assert.deepEqual(await download(), playerData);
		});
		it("should merge by the payload's components and ignore the instance config", async function() {
			disabled = ["appearance"];
			const components = Object.fromEntries(Object.keys(allComponents).map(c => [c, c !== "force"]));
			await upload({ generation: 2, name: "test", tag: "uploaded", components });
			assert.deepEqual(await download(), { generation: 2, name: "test", force: "player", tag: "uploaded" });
		});
	});
});
