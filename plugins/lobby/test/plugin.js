import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import * as lib from "@clusterio/lib";
import { Controller, HostRecord, InstanceRecord } from "@clusterio/controller";

import * as mock from "../../../test/mock.js";
import { testRoundTripJsonSerialisable, testMatrix } from "../../../test/common.js";
import { plugin as info } from "../dist/node/index.js";
import * as instancePlugin from "../dist/node/instance.js";
import { LobbyController, parseAddress } from "../dist/node/controller.js";
import { MatchingServerClient } from "../dist/node/matching_server.js";
import {
	LobbyServer, TransferRequest, TransferStatus, TransferStatusEvent, ServerListRequest,
} from "../dist/node/messages.js";

const v2_1_19 = { major: 2, minor: 1, sub: 19, build: 84000 };
const v2_0_72 = { major: 2, minor: 0, sub: 72, build: 83000 };

/** Fake of multiplayer.factorio.com recording the requests made to it */
function fakeMatchingServer() {
	const server = {
		games: new Map(),
		requests: [],
		nextId: 100,
		fetch: async (url, options) => {
			const uri = new URL(url).pathname.slice(1);
			const body = options.body ? JSON.parse(options.body) : undefined;
			server.requests.push({ uri, body });
			const [operation, id] = uri.split("/");
			const reply = (status, json) => new Response(JSON.stringify(json), { status });
			if (operation === "create-game") {
				const gameId = server.nextId;
				server.nextId += 1;
				server.games.set(gameId, body.game);
				return reply(200, { game_id: gameId, server_id: `id-${gameId}`, server_secret: `secret-${gameId}` });
			}
			const game = server.games.get(Number(id));
			if (!game || game.game_secret !== body.game_secret) {
				return reply(404, { message: "game not found" });
			}
			if (operation === "update-game") {
				server.games.set(Number(id), body.game);
			} else if (operation === "remove-game") {
				server.games.delete(Number(id));
			}
			return reply(200, { status: "ok" });
		},
	};
	return server;
}

const listing = (fields = {}) => ({
	name: "Cluster",
	description: "",
	tags: [],
	maxPlayers: 0,
	hostAddress: "203.0.113.1",
	hostPort: 34197,
	version: { version: "2.1.19", build: 84000 },
	players: [],
	...fields,
});

describe("lobby plugin", function () {
	before(function () {
		lib.addPluginConfigFields([info]);
		try {
			lib.registerPluginMessages([info]);
		} catch (err) {
			// Already registered by the full test suite
		}
	});

	describe("messages", function () {
		it("should round trip LobbyServer", function () {
			testRoundTripJsonSerialisable(LobbyServer, testMatrix(
				[1], ["Server"], ["running", "stopped"], [null, "2.1.19"], [0, 5],
			));
		});
		it("should round trip TransferStatus", function () {
			testRoundTripJsonSerialisable(TransferStatus, testMatrix(
				["starting", "ready", "failed"], ["Server"], [undefined, "example.com:34197"], [undefined, "error"],
			));
		});
		it("should round trip TransferRequest and TransferStatusEvent", function () {
			testRoundTripJsonSerialisable(TransferRequest, testMatrix(["Player"], [1, 2]));
			testRoundTripJsonSerialisable(TransferStatusEvent, testMatrix(
				["Player"], [1], [new TransferStatus("ready", "Server", "127.0.0.1:1")],
			));
		});
	});

	describe("parseAddress()", function () {
		it("should split host and port", function () {
			assert.deepEqual(parseAddress("example.com:34197"), { host: "example.com", port: 34197 });
			assert.deepEqual(parseAddress("1.2.3.4"), { host: "1.2.3.4", port: undefined });
			assert.deepEqual(parseAddress("[::1]:5"), { host: "::1", port: 5 });
		});
	});

	describe("MatchingServerClient", function () {
		let server;
		let client;
		let statePath;
		const credentials = { username: "user", token: "token" };

		beforeEach(async function () {
			server = fakeMatchingServer();
			statePath = path.join("temp", "test", "lobby", `listings-${Date.now()}-${Math.random()}.json`);
			client = new MatchingServerClient(new mock.MockLogger(), statePath, "https://matching.test", server.fetch);
		});

		afterEach(async function () {
			await fs.rm(statePath, { force: true });
		});

		it("should create, heartbeat, update and remove games", async function () {
			await client.sync(new Map([["a", listing()]]), credentials);
			assert.equal(server.games.size, 1);
			const [gameId] = server.games.keys();
			assert.equal(server.games.get(gameId).host_port, 34197);
			assert.equal(server.requests[0].body.username, "user");

			await client.sync(new Map([["a", listing()]]), credentials);
			assert.equal(server.requests.at(-1).uri, `post-game-heartbeat/${gameId}`);

			await client.sync(new Map([["a", listing({ players: ["alice", "bob"] })]]), credentials);
			assert.equal(server.requests.at(-1).uri, `update-game/${gameId}`);
			assert.deepEqual(server.games.get(gameId).players, ["alice", "bob"]);

			await client.sync(new Map(), credentials);
			assert.equal(server.games.size, 0);
		});

		it("should register a game again if the matching server forgot it", async function () {
			await client.sync(new Map([["a", listing()]]), credentials);
			server.games.clear();
			await client.sync(new Map([["a", listing()]]), credentials);
			assert.equal(server.games.size, 1);
			const create = server.requests.filter(r => r.uri === "create-game");
			assert.equal(create.length, 2);
			assert.equal(create[1].body.server_secret, "secret-100", "should keep server_id between games");
		});

		it("should take over listings from before a restart", async function () {
			await client.sync(new Map([["a", listing()], ["b", listing()]]), credentials);
			const restarted = new MatchingServerClient(
				new mock.MockLogger(), statePath, "https://matching.test", server.fetch
			);
			server.requests = [];
			await restarted.sync(new Map([["a", listing({ name: "Renamed" })]]), credentials);
			assert.equal(server.games.size, 1);
			assert.deepEqual(server.requests.map(r => r.uri.split("/")[0]).sort(), ["remove-game", "update-game"]);
		});

		it("should not create games without credentials", async function () {
			await client.sync(new Map([["a", listing()]]));
			assert.equal(server.games.size, 0);
		});
	});

	describe("LobbyController", function () {
		let controller;
		let lobby;
		let started;
		let sent;
		let proxy;

		function addInstance(id, fields = {}, status = "running", factorioVersion = "2.1.19") {
			const config = new lib.InstanceConfig("controller", {
				"instance.id": id,
				"instance.name": `Instance ${id}`,
				"instance.assigned_host": 1,
				"lobby.load_plugin": true,
				...fields,
			});
			const instance = new InstanceRecord(config, status, 30000 + id, factorioVersion);
			controller.instances.records.set(instance);
			return instance;
		}

		function setOnline(name, instanceId) {
			const user = controller.users.getOrCreateUser(name);
			user.instances = new Set(instanceId === undefined ? [] : [instanceId]);
			controller.users.records.set(user);
		}

		beforeEach(function () {
			const config = new lib.ControllerConfig("controller", {
				"controller.name": "Test Cluster",
				"controller.public_url": "https://play.example.com/",
			});
			controller = new Controller(lib.logger, [], config);
			controller.hosts.set(new HostRecord(1, "Host", "2.0.0", new Map(), true, "10.0.0.2", "198.51.100.2"));
			proxy = {
				port: 34197,
				serverVersions: new Map(),
				instanceVersion: async id => proxy.serverVersions.get(id),
			};
			controller.playerProxyServer = proxy;
			started = [];
			sent = [];
			controller.sendTo = async (dst, message) => {
				sent.push({ dst, message });
				if (message instanceof lib.InstanceStartRequest) {
					started.push(dst.instanceId);
				}
			};
			lobby = new LobbyController(controller, new mock.MockLogger(), new MatchingServerClient(
				new mock.MockLogger(), undefined, "https://matching.test", fakeMatchingServer().fetch,
			));

			addInstance(1, { "lobby.is_lobby": true });
			addInstance(2, { "lobby.is_lobby": true }, "running", "2.0.72");
			addInstance(3);
			addInstance(4, { "instance.player_proxy_port": 34200 }, "stopped", "latest");
			addInstance(5, { "lobby.listed": false });
		});

		const route = (fields = {}) => lobby.onPlayerProxyRoute({
			username: "Player", version: v2_1_19, clientAddress: "1.2.3.4", clientPort: 1, listenPort: 34197, ...fields,
		});

		it("should list instances that are not lobbies", function () {
			setOnline("alice", 3);
			const servers = lobby.serverList();
			assert.deepEqual(servers.map(s => s.id), [3, 4]);
			assert.equal(servers[0].players, 1);
			assert.equal(servers[0].version, "2.1.19");
			assert.equal(servers[1].version, null, "stopped instance with unknown version");
		});

		it("should send players to the lobby for their version", async function () {
			assert.equal(await route(), 1);
			assert.equal(await route({ version: v2_0_72 }), 2);
			assert.equal(await route({ version: { ...v2_1_19, sub: 1 } }), undefined);
		});

		it("should skip lobbies running a different build", async function () {
			proxy.serverVersions.set(1, { ...v2_1_19, build: 1 });
			assert.equal(await route(), undefined);
		});

		it("should transfer a player to a running instance", async function () {
			const status = await lobby.handleTransferRequest(
				new TransferRequest("Player", 3), lib.Address.fromShorthand({ instanceId: 1 })
			);
			assert.equal(status.state, "ready");
			assert.equal(status.address, "play.example.com:34197");
			assert.equal(await route(), 3, "both connection attempts should go to the target");
			assert.equal(await route(), 3);

			await lobby.onPlayerEvent(controller.instances.getMutable(3), { type: "join", name: "player" });
			assert.equal(await route(), 1, "should go back to the lobby after joining");
		});

		it("should start a stopped instance and tell the lobby when it's ready", async function () {
			controller.instances.getMutable(4).config.set("factorio.version", "2.1.19");
			const status = await lobby.handleTransferRequest(
				new TransferRequest("Player", 4), lib.Address.fromShorthand({ instanceId: 1 })
			);
			assert.equal(status.state, "starting");
			await lib.wait(0);
			assert.deepEqual(started, [4]);
			assert.equal(await route(), 1, "should wait in the lobby while starting");

			const instance = controller.instances.getMutable(4);
			instance.status = "running";
			await lobby.onInstanceStatusChanged(instance);
			const event = sent.find(s => s.message instanceof TransferStatusEvent);
			assert.deepEqual(event.dst, { instanceId: 1 });
			assert.equal(event.message.status.state, "ready");
			assert.equal(await route(), 4);
		});

		it("should report a transfer failing when the instance stops", async function () {
			await lobby.handleTransferRequest(
				new TransferRequest("Player", 4), lib.Address.fromShorthand({ instanceId: 1 })
			);
			await lobby.onInstanceStatusChanged(controller.instances.getMutable(4));
			const event = sent.find(s => s.message instanceof TransferStatusEvent);
			assert.equal(event.message.status.state, "failed");
			assert.equal(lobby.transfers.size, 0);
		});

		it("should hold players for a stopped dedicated port instance in the lobby", async function () {
			assert.equal(await route({ portInstanceId: 4 }), 1);
			await lib.wait(0);
			assert.deepEqual(started, [4]);
			await lobby.onPlayerEvent(controller.instances.getMutable(1), { type: "join", name: "Player" });
			const event = sent.find(s => s.message instanceof TransferStatusEvent);
			assert.equal(event.message.status.state, "starting");

			assert.equal(
				await route({ username: "Other", portInstanceId: 3 }), undefined,
				"running instances are routed by the proxy",
			);
		});

		it("should build server browser listings", async function () {
			controller.config.set("lobby.server_browser_listing", true);
			controller.config.set("lobby.public_address", "203.0.113.5:40000");
			controller.instances.getMutable(4).config.set("lobby.server_browser_listing", true);
			proxy.serverVersions.set(1, v2_1_19);
			proxy.serverVersions.set(2, v2_0_72);
			setOnline("alice", 3);
			setOnline("bob", 1);

			let listings = await lobby.desiredListings();
			assert.deepEqual([...listings.keys()], ["cluster:2.1.19:84000", "cluster:2.0.72:83000"]);
			const cluster = listings.get("cluster:2.1.19:84000");
			assert.equal(cluster.name, "Test Cluster");
			assert.equal(cluster.hostAddress, "203.0.113.5");
			assert.equal(cluster.hostPort, 40000);
			assert.deepEqual(cluster.players, ["alice", "bob"]);

			proxy.serverVersions.set(4, v2_1_19);
			listings = await lobby.desiredListings();
			const own = listings.get("instance:4");
			assert.equal(own.hostPort, 34200);
			assert.equal(own.name, "Instance 4");
		});

		it("should not list anything without the proxy", async function () {
			controller.config.set("lobby.server_browser_listing", true);
			controller.playerProxyServer = null;
			assert.equal((await lobby.desiredListings()).size, 0);
		});
	});

	describe("instance plugin", function () {
		let instance;

		beforeEach(async function () {
			({ instance } = await mock.loadInstancePlugin(instancePlugin.default, info));
			instance.mockConfigEntries.set("lobby.is_lobby", true);
			instance.sendTo = async (dst, message) => {
				if (message instanceof ServerListRequest) {
					return [new LobbyServer(3, "Instance \"3\"", "running", "2.1.19", 0)];
				}
				if (message instanceof TransferRequest) {
					return new TransferStatus("ready", "Instance 3", "play.example.com:34197");
				}
				throw new Error("unexpected message");
			};
		});

		afterEach(async function () {
			await instance?.hooks.stop.invoke();
		});

		it("should configure the module and send the server list on start", async function () {
			await instance.hooks.start.invoke();
			const commands = instance.server.rconCommands;
			assert.equal(commands[0], "/sc lobby.configure(true, 7357)");
			assert(commands[1].startsWith("/sc lobby.set_servers(\""), commands[1]);
			assert(commands[1].includes("Instance \\\\\\\"3\\\\\\\""), commands[1]);
		});

		it("should move players once their transfer is ready", async function () {
			instance.server.emit("ipc-lobby:connect", { player: "Player", instance_id: 3 });
			await lib.wait(10);
			assert.deepEqual(instance.server.rconCommands, [
				"/sc lobby.connect_player(\"Player\", \"play.example.com:34197\", \"Instance 3\")",
			]);
		});

		it("should show the status of a transfer that is starting", async function () {
			const handler = mock.getHandler(instance, TransferStatusEvent);
			await handler(new TransferStatusEvent("Player", 3, new TransferStatus("starting", "Instance 3")));
			assert.match(instance.server.rconCommands[0], /^\/sc lobby.set_player_status\("Player", "Starting/);
		});
	});
});
