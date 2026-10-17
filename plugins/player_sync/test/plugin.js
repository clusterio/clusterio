import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as lib from "@clusterio/lib";
import { CtlHooks } from "@clusterio/ctl";

import * as mock from "../../../test/mock.js";
import { testRoundTripJsonSerialisable, testMatrix } from "../../../test/common.js";
import * as msg from "../dist/node/messages.js";
import { summarizeInventory, summarizePlayerInventories } from "../dist/node/player_data.js";
import ctlEntrypoint from "../dist/node/ctl.js";
import { plugin as info } from "../dist/node/index.js";


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
			assert.deepEqual(summarizeInventory(JSON.parse('{"i":{}}')), []);
			assert.deepEqual(
				summarizeInventory({ i: [{ n: "wood" }] }),
				[{ name: "wood", quality: undefined, count: 0 }],
			);
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
		it("should handle empty serialized inventories", function() {
			const data = JSON.parse('{"generation":1,"name":"player","character":{"inventories":{"armor":{"i":{}}}}}');
			assert.deepEqual(summarizePlayerInventories(data), [{ name: "armor", items: [] }]);
		});
		it("should handle missing inventories", function() {
			assert.deepEqual(summarizePlayerInventories(playerData("player", 1)), []);
			assert.deepEqual(summarizePlayerInventories(playerData("player", 1, { character: {} })), []);
		});
	});

	describe("ctl commands", function() {
		let commands;
		let sent;
		let printed;
		let responses;
		const ctl = {
			async send(message) {
				sent.push(message);
				const handler = responses.get(message.constructor);
				if (!handler) {
					throw new Error(`Unexpected ${message.constructor.name}`);
				}
				return handler(message);
			},
		};
		const storedData = playerData("alice", 2, {
			character: { inventories: { main: { i: [{ n: "wood", c: 5, q: "rare" }, { e: "0eNq" }] } } },
		});
		let tempDir;

		before(async function() {
			const root = new lib.CommandTree({ name: "clusterioctl", description: "root" });
			const hooks = new CtlHooks(new mock.MockLogger());
			await ctlEntrypoint({ hooks, logger: new mock.MockLogger(), plugin: info });
			await hooks.addCommands.invoke(root);
			commands = root.subCommands.get("player-sync").subCommands;
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "player_sync-ctl-"));
		});
		after(async function() {
			await fs.rm(tempDir, { recursive: true, force: true });
		});
		beforeEach(function() {
			sent = [];
			printed = [];
			responses = new Map([
				[lib.InstanceDetailsGetRequest, request => ({ id: request.instanceId, name: "Test" })],
				[msg.ListPlayersRequest, () => [
					new msg.PlayerEntry("bob", undefined, undefined, 1),
					new msg.PlayerEntry("alice", 2, 100),
				]],
				[msg.GetPlayerDataRequest, request => new msg.GetPlayerDataResponse(
					request.playerName === "alice" ? storedData : null, request.playerName === "alice" ? 1 : undefined
				)],
				[msg.SetPlayerDataRequest, () => new msg.SetPlayerDataResponse(3)],
				[msg.DeletePlayerDataRequest, () => undefined],
				[msg.ForceReleaseRequest, () => undefined],
			]);
		});

		async function run(name, args = {}) {
			/* eslint-disable no-console */
			const original = console.log;
			console.log = (...values) => printed.push(values.join(" "));
			try {
				await commands.get(name).run(args, ctl);
			} finally {
				console.log = original;
			}
			/* eslint-enable no-console */
		}

		it("list should print sorted entries", async function() {
			await run("list");
			assert.deepEqual(printed, [
				"name | generation | size | acquired by",
				`alice | 2 | ${lib.formatBytes(100)} | -`,
				"bob | - | - | Test (1)",
			]);
		});
		it("show should print a summary", async function() {
			await run("show", { player: "alice" });
			assert.deepEqual(printed, [
				"acquired by: Test (1)",
				"generation: 2",
				`size: ${lib.formatBytes(JSON.stringify(storedData).length)}`,
				"controller: character",
				"force: player",
				"main:",
				"  5 wood (rare)",
				`  1 exported item ${lib.formatBytes(4)}`,
			]);
		});
		it("should show the instance ID when details can't be fetched", async function() {
			responses.set(lib.InstanceDetailsGetRequest, () => {
				throw new lib.PermissionError("Permission denied");
			});
			await run("list");
			assert.equal(printed[2], "bob | - | - | 1");
			printed = [];
			await run("show", { player: "alice" });
			assert.equal(printed[0], "acquired by: 1");
		});
		it("show should handle players without data", async function() {
			await run("show", { player: "carol" });
			assert.deepEqual(printed, ["acquired by: -", "No player data stored for carol"]);
		});
		it("export should print or write JSON", async function() {
			await run("export", { player: "alice" });
			assert.deepEqual(JSON.parse(printed.join("\n")), storedData);
			const file = path.join(tempDir, "alice.json");
			await run("export", { player: "alice", file });
			assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), storedData);
			await assert.rejects(
				run("export", { player: "carol" }),
				new lib.CommandError("No player data stored for carol"),
			);
		});
		it("import should send the file contents", async function() {
			const file = path.join(tempDir, "import.json");
			await fs.writeFile(file, JSON.stringify({ name: "other", controller: "god" }));
			await run("import", { player: "alice", file });
			assert.deepEqual(sent, [
				new msg.SetPlayerDataRequest("alice", { name: "alice", controller: "god", generation: 0 }),
			]);
			assert.deepEqual(printed, ["Stored player data for alice as generation 3"]);
		});
		it("import should reject non-object JSON", async function() {
			const file = path.join(tempDir, "bad.json");
			await fs.writeFile(file, "[1]");
			await assert.rejects(
				run("import", { player: "alice", file }),
				new lib.CommandError("Player data must be a JSON object"),
			);
		});
		it("delete and release should send requests", async function() {
			await run("delete", { player: "alice" });
			await run("release", { player: "alice" });
			assert.deepEqual(sent, [new msg.DeletePlayerDataRequest("alice"), new msg.ForceReleaseRequest("alice")]);
		});
	});
});
