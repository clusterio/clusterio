"use strict";
const assert = require("assert").strict;
const path = require("path");

const lib = require("@clusterio/lib");
const { PlayerStats, wait } = lib;
const Instance = require("@clusterio/host/dist/node/src/Instance").default;
const { MockConnector, MockServer } = require("../mock");

const addr = lib.Address.fromShorthand;


describe("class Instance", function() {
	let src;
	let dst = addr({ hostId: 1 });
	let instance;
	let connector;
	beforeEach(function() {
		let instanceConfig = new lib.InstanceConfig("host");
		instanceConfig.set("instance.name", "foo");
		src = addr({ instanceId: instanceConfig.get("instance.id") });
		connector = new MockConnector(src, dst);
		instance = new Instance({ assignGamePort: () => 1 }, connector, "dir", "factorioDir", instanceConfig);
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
			let stats = instance.playerStats.get("player");
			assert.deepEqual(
				connector.sentMessages[0],
				new lib.MessageEvent(
					1, src, addr("controller"), "InstancePlayerUpdateEvent",
					new lib.InstancePlayerUpdateEvent(
						"join",
						"player",
						new PlayerStats({
							join_count: 1,
							last_join_at_ms: stats.lastJoinAt.getTime(),
						})
					)
				),
			);
		});

		it("should be idempotent", async function() {
			instance._recordPlayerJoin("player");
			await wait(10);
			instance._recordPlayerJoin("player");
			assert(instance.playersOnline.has("player"), "player was not added");
			assert.equal(connector.sentMessages.length, 1);
		});
	});

	describe("._recordPlayerLeave()", function() {
		it("should remove player to playersOnline", async function() {
			instance._recordPlayerJoin("player");
			await wait(10);
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

		it("should send player_event", async function() {
			instance._recordPlayerJoin("player");
			await wait(10);
			instance._recordPlayerLeave("player", "quit");
			let stats = instance.playerStats.get("player");
			assert.deepEqual(
				connector.sentMessages[1],
				new lib.MessageEvent(
					2, src, addr("controller"), "InstancePlayerUpdateEvent",
					new lib.InstancePlayerUpdateEvent(
						"leave",
						"player",
						new PlayerStats({
							join_count: 1,
							online_time_ms: stats.onlineTimeMs,
							last_join_at_ms: stats.lastJoinAt.getTime(),
							last_leave_at_ms: stats.lastLeaveAt.getTime(),
							last_leave_reason: "quit",
						}),
						"quit",
					)
				),
			);
		});

		it("should be idempotent", async function() {
			instance._recordPlayerJoin("player");
			await wait(10);
			instance._recordPlayerLeave("player", "quit");
			await wait(10);
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
			let stats = instance.playerStats.get("foo");
			assert.deepEqual(
				connector.sentMessages[1],
				new lib.MessageEvent(
					2, src, addr("controller"), "InstancePlayerUpdateEvent",
					new lib.InstancePlayerUpdateEvent(
						"join",
						"foo",
						new PlayerStats({
							join_count: 1,
							last_join_at_ms: stats.lastJoinAt.getTime(),
						})
					)
				)
			);
		});

		it("should remove extra players", async function() {
			instance.server.rconCommandResults.set("/players online", "Online Players (0):\n");
			instance._recordPlayerJoin("player");
			await wait(10);
			await instance._checkOnlinePlayers();
			let stats = instance.playerStats.get("player");
			assert.deepEqual(
				connector.sentMessages[1],
				new lib.MessageEvent(
					2, src, addr("controller"), "InstancePlayerUpdateEvent",
					new lib.InstancePlayerUpdateEvent(
						"leave",
						"player",
						new PlayerStats({
							join_count: 1,
							online_time_ms: stats.onlineTimeMs,
							last_join_at_ms: stats.lastJoinAt.getTime(),
							last_leave_at_ms: stats.lastLeaveAt.getTime(),
							last_leave_reason: "quit",
						}),
						"quit",
					)
				)
			);
		});
	});

	describe("_recordUserUpdate()", function() {
		beforeEach(function() {
			instance.config.set("factorio.sync_banlist", "bidirectional");
			instance.config.set("factorio.sync_adminlist", "bidirectional");
			instance.config.set("factorio.sync_whitelist", "bidirectional");
		});
		it("should send InstanceBanlistUpdateEvent for bans", function() {
			instance._recordUserUpdate("BAN", "player", "reason");
			assert.deepEqual(
				connector.sentMessages[0],
				new lib.MessageEvent(
					1, src, addr("allInstances"), "InstanceBanlistUpdateEvent",
					new lib.InstanceBanlistUpdateEvent(
						"player",
						true,
						"reason",
					)
				),
			);
		});
		it("should send InstanceBanlistUpdateEvent for unbans", function() {
			instance._recordUserUpdate("UNBANNED", "player");
			assert.deepEqual(
				connector.sentMessages[0],
				new lib.MessageEvent(
					1, src, addr("allInstances"), "InstanceBanlistUpdateEvent",
					new lib.InstanceBanlistUpdateEvent(
						"player",
						false,
						"",
					)
				),
			);
		});
		it("should send InstanceAdminlistUpdateEvent for promotes", function() {
			instance._recordUserUpdate("PROMOTE", "player");
			assert.deepEqual(
				connector.sentMessages[0],
				new lib.MessageEvent(
					1, src, addr("allInstances"), "InstanceAdminlistUpdateEvent",
					new lib.InstanceAdminlistUpdateEvent(
						"player",
						true,
					)
				),
			);
		});
		it("should send InstanceAdminlistUpdateEvent for demotes", function() {
			instance._recordUserUpdate("DEMOTE", "player");
			assert.deepEqual(
				connector.sentMessages[0],
				new lib.MessageEvent(
					1, src, addr("allInstances"), "InstanceAdminlistUpdateEvent",
					new lib.InstanceAdminlistUpdateEvent(
						"player",
						false,
					)
				),
			);
		});
		it("should send InstanceWhitelistUpdateEvent for whitelist add", function() {
			instance._recordUserUpdate("WHITELISTED", "player");
			assert.deepEqual(
				connector.sentMessages[0],
				new lib.MessageEvent(
					1, src, addr("allInstances"), "InstanceWhitelistUpdateEvent",
					new lib.InstanceWhitelistUpdateEvent(
						"player",
						true,
					)
				),
			);
		});
		it("should send InstanceWhitelistUpdateEvent for whitelist remove", function() {
			instance._recordUserUpdate("UNWHITELISTED", "player");
			assert.deepEqual(
				connector.sentMessages[0],
				new lib.MessageEvent(
					1, src, addr("allInstances"), "InstanceWhitelistUpdateEvent",
					new lib.InstanceWhitelistUpdateEvent(
						"player",
						false,
					)
				),
			);
		});
		it("should throw for unknown event types", function() {
			assert.throws(() => {
				instance._recordUserUpdate("INVALID TYPE", "player");
			});
		});
		it("should not send events when it is not bidirectional", function() {
			for (const configValue of ["disabled", "enabled"]) { // Excludes Bidirectional
				instance.config.set("factorio.sync_banlist", configValue);
				instance.config.set("factorio.sync_adminlist", configValue);
				instance.config.set("factorio.sync_whitelist", configValue);
				for (const eventType of
					["BAN", "UNBANNED", "PROMOTE", "DEMOTE", "WHITELISTED", "UNWHITELISTED"]
				) {
					instance._recordUserUpdate(eventType, "player");
					assert.equal(connector.sentMessages[0], undefined);
				}
			}
		});
	});
});
