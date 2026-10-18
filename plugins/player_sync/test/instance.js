import assert from "node:assert/strict";
import util from "node:util";
import zlib from "node:zlib";
import * as lib from "@clusterio/lib";

import * as mock from "../../../test/mock.js";
import loadInstancePlugin, { recipeNotificationDelta, applyRecipeNotificationDelta } from "../dist/node/instance.js";
import { AcquireResponse, DownloadResponse, PrefetchEvent } from "../dist/node/messages.js";
import { components } from "../dist/node/components.js";
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

describe("player_sync", function() {
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

	describe("applyRecipeNotificationDelta()", function() {
		const warnings = [];
		const logger = { warn: msg => warnings.push(msg) };
		const apply = (playerData, current) => applyRecipeNotificationDelta(playerData, current, logger);

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
		it("should send the whole list marked full without a current list", async function() {
			const playerData = { name: "test", recipe_notifications: await encode(["a"]) };
			await apply(playerData, undefined);
			assert.deepEqual(await decode(playerData.recipe_notifications), { add: ["a"], full: true });
		});
		it("should mark an empty list full without a current list", async function() {
			const playerData = { name: "test", recipe_notifications: await encode([]) };
			await apply(playerData, undefined);
			assert.deepEqual(await decode(playerData.recipe_notifications), { full: true });
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

	describe("ipc-player_sync_download", function() {
		let instance;
		before(async function() {
			try {
				lib.registerPluginMessages([info]);
			} catch (err) {
				// Already registered by the full test suite
			}
			({ instance } = await mock.loadInstancePlugin(loadInstancePlugin, info));
			instance.mockConfigEntries.set("player_sync.rcon_chunk_size", 100000);
		});
		beforeEach(function() {
			instance.server.reset();
			for (const component of Object.keys(components)) {
				instance.mockConfigEntries.set(`player_sync.sync_${component}`, true);
			}
		});

		function respondWith(playerData) {
			instance.connector.once("send", message => {
				instance.connector.emit("message", new lib.MessageResponse(
					1, message.dst, message.src, new DownloadResponse(playerData)
				));
			});
		}
		async function download(request) {
			instance.server.emit("ipc-player_sync_download", request);
			// zlib runs on the threadpool, so poll on timers rather than setImmediate
			for (let i = 0; i < 1000 && !instance.server.rconCommands.length; i++) {
				await lib.wait(1);
			}
		}
		function downloadCommand(playerData, enabled = Object.keys(components)) {
			const json = lib.escapeString(JSON.stringify(playerData));
			const sent = lib.escapeString(JSON.stringify(Object.fromEntries(enabled.map(c => [c, true]))));
			return `/sc player_sync.download_inventory('test','${json}',1,1,'${sent}')`;
		}

		it("should send an empty download when the controller has no data", async function() {
			respondWith(undefined);
			await download({ player_name: "test" });
			assert.deepEqual(
				instance.server.rconCommands,
				["/sc player_sync.download_inventory('test',nil,0,0)"]
			);
		});
		it("should send everything as a full delta when no snapshot was given", async function() {
			respondWith({ generation: 1, name: "test", recipe_notifications: await encode(["a"]) });
			await download({ player_name: "test" });
			const expected = {
				generation: 1, name: "test", recipe_notifications: await encode({ add: ["a"], full: true }),
			};
			assert.deepEqual(instance.server.rconCommands, [downloadCommand(expected)]);
		});
		it("should send a delta when a snapshot was given", async function() {
			respondWith({ generation: 1, name: "test", recipe_notifications: await encode(["a", "b"]) });
			await download({ player_name: "test", recipe_notifications: await encode(["b"]) });
			const expected = { generation: 1, name: "test", recipe_notifications: await encode({ add: ["a"] }) };
			assert.deepEqual(instance.server.rconCommands, [downloadCommand(expected)]);
		});
		it("should leave out components which are not synced", async function() {
			for (const component of Object.keys(components)) {
				instance.mockConfigEntries.set(`player_sync.sync_${component}`, component === "appearance");
			}
			respondWith({ generation: 1, name: "test", force: "enemy", tag: "tag", recipe_notifications: "x" });
			await download({ player_name: "test" });
			const expected = { generation: 1, name: "test", tag: "tag" };
			assert.deepEqual(instance.server.rconCommands, [downloadCommand(expected, ["appearance"])]);
		});
		it("should send the components it stripped by when the config changes during the download", async function() {
			instance.connector.once("send", message => {
				instance.mockConfigEntries.set("player_sync.sync_force", false);
				instance.connector.emit("message", new lib.MessageResponse(
					1, message.dst, message.src,
					new DownloadResponse({ generation: 1, name: "test", force: "enemy", tag: "tag" }),
				));
			});
			await download({ player_name: "test" });
			const expected = { generation: 1, name: "test", tag: "tag" };
			const enabled = Object.keys(components).filter(c => c !== "force");
			assert.deepEqual(instance.server.rconCommands, [downloadCommand(expected, enabled)]);
		});
		it("should only send the components with the first chunk", async function() {
			instance.mockConfigEntries.set("player_sync.rcon_chunk_size", 10);
			try {
				respondWith({ generation: 1, name: "test" });
				await download({ player_name: "test" });
				for (let i = 0; i < 50 && instance.server.rconCommands.length < 3; i++) {
					await lib.wait(1);
				}
				const [first, ...rest] = instance.server.rconCommands;
				assert.match(first, /,1,3,'.+'\)$/);
				for (const command of rest) {
					assert.match(command, /,\d,3\)$/);
				}
			} finally {
				instance.mockConfigEntries.set("player_sync.rcon_chunk_size", 100000);
			}
		});
	});

	describe("set_components", function() {
		let instance;
		before(async function() {
			({ instance } = await mock.loadInstancePlugin(loadInstancePlugin, info));
		});
		beforeEach(function() {
			instance.server.reset();
			for (const component of Object.keys(components)) {
				instance.mockConfigEntries.set(`player_sync.sync_${component}`, true);
			}
		});

		it("should send the synced components on start", async function() {
			instance.mockConfigEntries.set("player_sync.sync_quick_bar", false);
			await instance.hooks.start.invoke();
			const enabled = Object.fromEntries(
				Object.keys(components).filter(c => c !== "quick_bar").map(c => [c, true])
			);
			const json = lib.escapeString(JSON.stringify(enabled));
			assert.deepEqual(
				instance.server.rconCommands,
				[`/sc player_sync.set_components("${json}")`]
			);
		});
		it("should send the synced components when one is changed", async function() {
			await instance.hooks.instanceConfigFieldChanged.invoke("player_sync.rcon_chunk_size", 1, 2);
			assert.equal(instance.server.rconCommands.length, 0);
			await instance.hooks.instanceConfigFieldChanged.invoke("player_sync.sync_force", false, true);
			assert.equal(instance.server.rconCommands.length, 1);
		});
		it("should not send the components when the instance is not running", async function() {
			instance.status = "stopped";
			try {
				await instance.hooks.instanceConfigFieldChanged.invoke("player_sync.sync_force", false, true);
			} finally {
				instance.status = "running";
			}
			assert.equal(instance.server.rconCommands.length, 0);
		});
	});

	describe("ipc-player_sync_upload", function() {
		let instance;
		before(async function() {
			try {
				lib.registerPluginMessages([info]);
			} catch (err) {
				// Already registered by the full test suite
			}
			({ instance } = await mock.loadInstancePlugin(loadInstancePlugin, info));
		});
		beforeEach(function() {
			instance.connector.sentMessages = [];
		});

		// The UploadRequest the instance sends the controller (no response is given; only the request is checked)
		async function upload(playerData) {
			instance.server.emit("ipc-player_sync_upload", playerData);
			for (let i = 0; i < 100 && !instance.connector.sentMessages.length; i++) {
				await lib.wait(1);
			}
			return instance.connector.sentMessages[0].data;
		}

		it("should pass destination_instance_id on as destinationInstanceId, not as player data", async function() {
			const request = await upload({ name: "test", generation: 2, destination_instance_id: 7 });
			assert.equal(request.destinationInstanceId, 7);
			assert.deepEqual(request.playerData, { name: "test", generation: 2 });
		});
		it("should send no destination without the field", async function() {
			const request = await upload({ name: "test", generation: 2 });
			assert.equal(request.destinationInstanceId, undefined);
		});
	});

	describe("PrefetchEvent", function() {
		let instance;
		before(async function() {
			try {
				lib.registerPluginMessages([info]);
			} catch (err) {
				// Already registered by the full test suite
			}
			({ instance } = await mock.loadInstancePlugin(loadInstancePlugin, info));
			instance.mockConfigEntries.set("player_sync.rcon_chunk_size", 10);
		});
		beforeEach(function() {
			instance.server.reset();
			for (const component of Object.keys(components)) {
				instance.mockConfigEntries.set(`player_sync.sync_${component}`, true);
			}
		});

		const prefetch = playerData => mock.getHandler(instance, PrefetchEvent)(new PrefetchEvent(playerData, "tok"));
		function prefetchCommands(playerData, enabled = Object.keys(components)) {
			const chunks = JSON.stringify(playerData).match(/.{1,10}/g);
			const sent = lib.escapeString(JSON.stringify(Object.fromEntries(enabled.map(c => [c, true]))));
			return chunks.map((chunk, i) => "/sc player_sync.prefetch_inventory(" +
				`'test',${playerData.generation},'${lib.escapeString(chunk)}',${i + 1},${chunks.length}` +
				`${i === 0 ? `,'${sent}','tok'` : ""})`);
		}

		it("should send prefetch_inventory chunks with the generation and the full recipe list", async function() {
			await prefetch({ generation: 3, name: "test", recipe_notifications: await encode(["a"]) });
			const expected = {
				generation: 3, name: "test", recipe_notifications: await encode({ add: ["a"], full: true }),
			};
			assert.ok(instance.server.rconCommands.length > 1, "more than one chunk");
			assert.deepEqual(instance.server.rconCommands, prefetchCommands(expected));
		});
		it("should leave out components which are not synced and send the components with chunk 1", async function() {
			instance.mockConfigEntries.set("player_sync.sync_force", false);
			await prefetch({ generation: 3, name: "test", force: "enemy", tag: "tag" });
			const enabled = Object.keys(components).filter(c => c !== "force");
			const commands = prefetchCommands({ generation: 3, name: "test", tag: "tag" }, enabled);
			assert.ok(commands.length > 1, "more than one chunk");
			assert.deepEqual(instance.server.rconCommands, commands);
		});
		it("should send the token with the first chunk only", async function() {
			await prefetch({ generation: 3, name: "test" });
			const commands = instance.server.rconCommands;
			assert.ok(commands[0].endsWith(",'tok')"));
			assert.ok(commands.slice(1).every(command => !command.includes("tok")));
		});
		it("should stop when the save refuses the first chunk", async function() {
			const playerData = { generation: 3, name: "test" };
			const commands = prefetchCommands(playerData);
			instance.server.rconCommandResults.set(commands[0], "Refused prefetch for test: online here");
			await prefetch(playerData);
			assert.deepEqual(instance.server.rconCommands, commands.slice(0, 1));
		});
		it("should stop at the first non-empty reply mid-stream", async function() {
			const playerData = { generation: 3, name: "test" };
			const commands = prefetchCommands(playerData);
			assert.equal(commands.length, 3);
			instance.server.rconCommandResults.set(commands[1], "Ignored prefetch chunk 2 for test");
			await prefetch(playerData);
			assert.deepEqual(instance.server.rconCommands, commands.slice(0, 2));
		});
	});

	describe("acquire reply", function() {
		it("should pass the controller's token to acquire_response", async function() {
			try {
				lib.registerPluginMessages([info]);
			} catch (err) {
				// Already registered by the full test suite
			}
			const { instance, host } = await mock.loadInstancePlugin(loadInstancePlugin, info);
			host.connector.connected = true;
			instance.sendTo = async () => new AcquireResponse("acquired", 4, true, undefined, undefined, "tok");
			instance.server.emit("ipc-player_sync_acquire", { player_name: "test" });
			await lib.wait(10);
			const [command] = instance.server.rconCommands;
			assert.ok(command.startsWith("/sc player_sync.acquire_response("), command);
			assert.ok(command.includes(lib.escapeString('"token":"tok"')), command);
		});
	});
});
