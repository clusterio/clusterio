"use strict";
const assert = require("assert").strict;
const path = require("path");

const libConfig = require("@clusterio/lib/config");
const { wait } = require("@clusterio/lib/helpers");
const Instance = require("@clusterio/slave/src/Instance");
const { MockConnector, MockServer } = require("../mock");


describe("class Instance", function() {
	before(function() {
		libConfig.InstanceConfig.finalize();
	});

	let instance;
	let connector;
	beforeEach(async function() {
		let instanceConfig = new libConfig.InstanceConfig("slave");
		await instanceConfig.init();
		instanceConfig.set("instance.name", "foo");
		connector = new MockConnector();
		instance = new Instance({}, connector, "dir", "factorioDir", instanceConfig);
		instance.server = new MockServer();
	});

	describe(".name", function() {
		it("should give the name of the instance", function() {
			assert.equal(instance.name, "foo");
		});
	});

	describe(".path()", function() {
		it("should give the path when called without arguments", function() {
			assert.equal(instance.path(), "dir");
		});
		it("should join path with arguments", function() {
			assert.equal(instance.path("bar"), path.join("dir", "bar"));
		});
	});

	describe("._recordPlayerJoin()", function() {
		it("should add player to playersOnline", function() {
			instance._recordPlayerJoin("player");
			assert(instance.playersOnline.has("player"), "player was not added");
		});

		it("should create playerStats entry", function() {
			assert(!instance.playerStats.has("player"));
			instance._recordPlayerJoin("player");
			assert(instance.playerStats.has("player"), "player was not added to stats");
		});


		it("should send player_event", function() {
			instance._recordPlayerJoin("player");
			assert.deepEqual(
				connector.sentMessages[0],
				{
					seq: 1,
					type: "player_event_event",
					data: { type: "join", instance_id: instance.id, name: "player" },
				},
			);
		});

		it("should be idempotent", function() {
			instance._recordPlayerJoin("player");
			instance._recordPlayerJoin("player");
			assert(instance.playersOnline.has("player"), "player was not added");
			assert.equal(connector.sentMessages.length, 1);
		});
	});

	describe("._recordPlayerLeave()", function() {
		it("should remove player to playersOnline", function() {
			instance._recordPlayerJoin("player");
			instance._recordPlayerLeave("player");
			assert(!instance.playersOnline.has("player"), "player was not removed");
		});

		it("should update playerStats", async function() {
			instance._recordPlayerJoin("player");
			await wait(10);
			instance._recordPlayerLeave("player");
			assert(instance.playerStats.has("player"), "playerStats record missing");
			assert(instance.playerStats.get("player").onlineTimeMs > 0, "no onlineTimeMs recorded");
		});

		it("should send player_event", function() {
			instance._recordPlayerJoin("player");
			instance._recordPlayerLeave("player", "quit");
			assert.deepEqual(
				connector.sentMessages[1],
				{
					seq: 2,
					type: "player_event_event",
					data: { type: "leave", instance_id: instance.id, name: "player", reason: "quit" },
				},
			);
		});

		it("should be idempotent", function() {
			instance._recordPlayerJoin("player");
			instance._recordPlayerLeave("player", "quit");
			instance._recordPlayerLeave("player", "quit");
			assert(!instance.playersOnline.has("player"), "player was not removed");
			assert.equal(connector.sentMessages.length, 2);
		});
	});

	describe("._checkOnlinePlayers()", function() {
		it("should do nothing on empty server", async function() {
			await instance._checkOnlinePlayers();
			assert.equal(instance.server.rconCommands.length, 0, "commands were sent");
			assert.equal(connector.sentMessages.length, 0, "messages were sent");
		});

		it("should do nothing on correct online presence", async function() {
			instance.server.rconCommandResults.set("/players online", "Online Players (1):\n  player (online)\n");
			instance.playersOnline.add("player");
			await instance._checkOnlinePlayers();
			assert.equal(connector.sentMessages.length, 0, "messages were sent");
		});

		it("should add missing players", async function() {
			instance.server.rconCommandResults.set(
				"/players online", "Online Players (2):\n  player (online)\n  foo (online)\n"
			);
			instance._recordPlayerJoin("player");
			await instance._checkOnlinePlayers();
			assert.deepEqual(
				connector.sentMessages[1],
				{
					seq: 2,
					type: "player_event_event",
					data: { type: "join", instance_id: instance.id, name: "foo" },
				},
			);
		});

		it("should remove extra players", async function() {
			instance.server.rconCommandResults.set("/players online", "Online Players (0):\n");
			instance._recordPlayerJoin("player");
			await instance._checkOnlinePlayers();
			assert.deepEqual(
				connector.sentMessages[1],
				{
					seq: 2,
					type: "player_event_event",
					data: { type: "leave", instance_id: instance.id, name: "player", reason: "quit" },
				},
			);
		});
	});
});
