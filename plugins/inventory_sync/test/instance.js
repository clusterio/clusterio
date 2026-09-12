import assert from "node:assert/strict";
import util from "node:util";
import zlib from "node:zlib";
import * as lib from "@clusterio/lib";

import * as mock from "../../../test/mock.js";
import { recipeNotificationDelta, InstancePlugin } from "../dist/node/instance.js";
import { DownloadResponse } from "../dist/node/messages.js";
import { plugin as info } from "../dist/node/index.js";

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
			assert.deepEqual(await decode(playerData.recipe_notifications), { add: ["a"], remove: ["c"] });
		});
		it("should send an empty delta when nothing changed", async function() {
			const playerData = { name: "test", recipe_notifications: await encode(["a"]) };
			await apply(playerData, await encode(["a"]));
			assert.deepEqual(await decode(playerData.recipe_notifications), {});
		});
		it("should add everything without a current list", async function() {
			const playerData = { name: "test", recipe_notifications: await encode(["a"]) };
			await apply(playerData, undefined);
			assert.deepEqual(await decode(playerData.recipe_notifications), { add: ["a"] });
		});
		it("should do nothing without stored notifications", async function() {
			const playerData = { name: "test" };
			await apply(playerData, await encode(["a"]));
			assert.deepEqual(playerData, { name: "test" });
		});
		it("should drop the field on invalid input", async function() {
			const playerData = { name: "test", recipe_notifications: "not base64 zlib" };
			await apply(playerData, await encode(["a"]));
			assert.equal(playerData.recipe_notifications, undefined);
			assert.equal(warnings.length, 1);
		});
	});

	describe("InstancePlugin.handleDownload()", function() {
		let instancePlugin;
		before(async function() {
			try {
				lib.registerPluginMessages([info]);
			} catch (err) {
				// Already registered by the full test suite
			}
			instancePlugin = await mock.createInstancePlugin(InstancePlugin, info);
			instancePlugin.instance.mockConfigEntries.set("inventory_sync.rcon_chunk_size", 100000);
		});
		beforeEach(function() {
			instancePlugin.instance.server.reset();
		});

		function respondWith(playerData) {
			instancePlugin.instance.connector.once("send", message => {
				instancePlugin.instance.connector.emit("message", new lib.MessageResponse(
					1, message.dst, message.src, new DownloadResponse(playerData)
				));
			});
		}
		function downloadCommand(playerData) {
			const json = lib.escapeString(JSON.stringify(playerData));
			return `/sc inventory_sync.download_inventory('test','${json}',1,1)`;
		}

		it("should send an empty download when the controller has no data", async function() {
			respondWith(undefined);
			await instancePlugin.handleDownload({ player_name: "test" });
			assert.deepEqual(
				instancePlugin.instance.server.rconCommands,
				["/sc inventory_sync.download_inventory('test',nil,0,0)"]
			);
		});
		it("should send everything as a delta when no snapshot was given", async function() {
			respondWith({ generation: 1, name: "test", recipe_notifications: await encode(["a"]) });
			await instancePlugin.handleDownload({ player_name: "test" });
			const expected = { generation: 1, name: "test", recipe_notifications: await encode({ add: ["a"] }) };
			assert.deepEqual(instancePlugin.instance.server.rconCommands, [downloadCommand(expected)]);
		});
		it("should send a delta when a snapshot was given", async function() {
			respondWith({ generation: 1, name: "test", recipe_notifications: await encode(["a", "b"]) });
			await instancePlugin.handleDownload({ player_name: "test", recipe_notifications: await encode(["b"]) });
			const expected = { generation: 1, name: "test", recipe_notifications: await encode({ add: ["a"] }) };
			assert.deepEqual(instancePlugin.instance.server.rconCommands, [downloadCommand(expected)]);
		});
		it("should be invoked by the download ipc", async function() {
			respondWith(undefined);
			instancePlugin.instance.server.emit("ipc-inventory_sync_download", { player_name: "test" });
			for (let i = 0; i < 100 && !instancePlugin.instance.server.rconCommands.length; i++) {
				await new Promise(resolve => setImmediate(resolve));
			}
			assert.equal(instancePlugin.instance.server.rconCommands.length, 1);
		});
	});
});
