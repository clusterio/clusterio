import assert from "node:assert/strict";
import path from "node:path";

import * as lib from "@clusterio/lib";
import { PlayerStats, wait } from "@clusterio/lib";
import Instance from "@clusterio/host/dist/node/src/Instance.js";
import { MockConnector, MockLogger, MockServer } from "../mock.js";

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

	describe("config fieldChanged", function() {
		let errors;
		let rejections;
		let hookInvoked;
		function onRejection(err) { rejections.push(err); }
		beforeEach(function() {
			errors = [];
			rejections = [];
			instance.logger = new MockLogger();
			instance.logger.error = message => errors.push(message);
			instance.server.exampleSettings = async () => ({});
			instance.notifyStatus("running");
			hookInvoked = new Promise(resolve => {
				instance.hooks.instanceConfigFieldChanged.attach("test", field => resolve(field));
			});
			process.on("unhandledRejection", onRejection);
		});
		afterEach(function() {
			process.off("unhandledRejection", onRejection);
		});

		it("should log whitelist update errors and invoke the hook", async function() {
			instance.server.sendRcon = async () => { throw new Error("Expected state running,stopping"); };
			instance.config.set("factorio.enable_whitelist", true);
			assert.equal(await hookInvoked, "factorio.enable_whitelist");
			await wait(10);
			assert.deepEqual(rejections, []);
			assert.equal(errors.length, 1);
			assert.match(errors[0], /^Error updating whitelist:\nError: Expected state running,stopping/);
		});

		it("should log server settings update errors and invoke the hook", async function() {
			instance.server.exampleSettings = async () => { throw new Error("no example settings"); };
			instance.config.set("factorio.settings", { name: "bar" });
			assert.equal(await hookInvoked, "factorio.settings");
			await wait(10);
			assert.deepEqual(rejections, []);
			assert.equal(errors.length, 1);
			assert.match(errors[0], /^Error updating server settings:\nError: no example settings/);
		});

		it("should apply tags with non-string elements", async function() {
			instance.config.set("factorio.settings", { tags: [1, "a b"] });
			await hookInvoked;
			await wait(10);
			assert.deepEqual(rejections, []);
			assert.deepEqual(errors, []);
			assert.deepEqual(instance.server.rconCommands, ["/config set tags 1 a b"]);
		});

		it("should defer changes made while starting until the instance is running", async function() {
			instance.notifyStatus("starting");
			instance.config.set("factorio.settings", { tags: ["a"] });
			await wait(10);
			assert.deepEqual(instance.server.rconCommands, [], "command sent while starting");
			instance.notifyStatus("running");
			await wait(10);
			assert.deepEqual(instance.server.rconCommands, ["/config set tags a"]);
			assert.deepEqual(errors, []);
			assert.deepEqual(rejections, []);
		});

		it("should drop changes made while starting if the instance stops", async function() {
			instance.notifyStatus("starting");
			instance.config.set("factorio.settings", { tags: ["a"] });
			await wait(10);
			instance.notifyStatus("stopped");
			await wait(10);
			assert.deepEqual(instance.server.rconCommands, []);
			assert.deepEqual(errors, []);
			assert.deepEqual(rejections, []);
		});

		it("should do nothing for changes made while stopped", async function() {
			instance.notifyStatus("stopped");
			instance.config.set("factorio.settings", { tags: ["a"] });
			await wait(10);
			assert.deepEqual(instance.server.rconCommands, []);
			assert.deepEqual(errors, []);
			assert.deepEqual(rejections, []);
		});

		it("should invoke the hook while starting without waiting for the instance", async function() {
			instance.notifyStatus("starting");
			instance.config.set("factorio.settings", { tags: ["a"] });
			assert.equal(await hookInvoked, "factorio.settings");
			assert.deepEqual(instance.server.rconCommands, [], "command sent while starting");
			instance.notifyStatus("stopped");
			await wait(10);
		});

		it("should invoke the hook for fields applied to the server directly", async function() {
			instance.config.set("factorio.shutdown_timeout", 30);
			assert.equal(await hookInvoked, "factorio.shutdown_timeout");
			assert.equal(instance.server.shutdownTimeoutMs, 30000);
			await wait(10);
			assert.deepEqual(errors, []);
			assert.deepEqual(rejections, []);
		});

		it("should invoke the hook exactly once per field changed", async function() {
			let invoked = [];
			instance._host.whitelist = new Set();
			instance.hooks.instanceConfigFieldChanged.attach("count", field => { invoked.push(field); });
			instance.config.set("factorio.settings", { tags: ["a"] });
			instance.config.set("factorio.enable_whitelist", true);
			instance.config.set("factorio.shutdown_timeout", 30);
			instance.config.set("factorio.max_concurrent_commands", 3);
			await wait(10);
			assert.deepEqual(invoked, [
				"factorio.settings",
				"factorio.enable_whitelist",
				"factorio.shutdown_timeout",
				"factorio.max_concurrent_commands",
			]);
			assert.equal(instance.server.maxConcurrentCommands, 3);
			assert.deepEqual(errors, []);
			assert.deepEqual(rejections, []);
		});
	});

	describe("list update events", function() {
		let errors;
		beforeEach(function() {
			errors = [];
			instance.logger = new MockLogger();
			instance.logger.error = message => errors.push(message);
		});

		it("should apply an update received while starting once running", async function() {
			instance.notifyStatus("starting");
			let handled = instance.handleInstanceAdminlistUpdateEvent(
				new lib.InstanceAdminlistUpdateEvent("player", true)
			);
			await wait(10);
			assert.deepEqual(instance.server.rconCommands, [], "command sent while starting");
			instance.notifyStatus("running");
			await handled;
			assert.deepEqual(instance.server.rconCommands, ["/promote player"]);
			assert.deepEqual(errors, []);
		});

		it("should drop an update received while starting if the instance stops", async function() {
			instance.notifyStatus("starting");
			let handled = instance.handleInstanceAdminlistUpdateEvent(
				new lib.InstanceAdminlistUpdateEvent("player", true)
			);
			await wait(10);
			instance.notifyStatus("stopped");
			await handled;
			assert.deepEqual(instance.server.rconCommands, []);
			assert.deepEqual(errors, []);
		});
	});

	describe(".checkModPackVersion()", function() {
		function modPack(factorioVersion) {
			return lib.ModPack.fromJSON({ name: "pack", factorio_version: factorioVersion });
		}

		it("should accept a mod pack for an older or equal Factorio version", function() {
			instance.server.version = "1.1.91";
			instance.checkModPackVersion(modPack("1.1"));
			instance.checkModPackVersion(modPack("1.1.90"));
			instance.checkModPackVersion(modPack("1.1.91"));
		});

		it("should reject a mod pack for a newer Factorio version", function() {
			instance.server.version = "1.1.91";
			assert.throws(
				() => instance.checkModPackVersion(modPack("1.1.110")),
				new lib.RequestError(
					"Mod pack pack is for Factorio 1.1.110 which is newer than the Factorio 1.1.91 this instance runs"
				)
			);
			assert.throws(() => instance.checkModPackVersion(modPack("2.0")), lib.RequestError);
		});

		it("should skip the check when the server version is unknown", function() {
			instance.checkModPackVersion(modPack("2.0"));
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

	describe("_watchServerLogActions()", function() {
		beforeEach(function() {
			instance.config.set("factorio.sync_banlist", "bidirectional");
			instance._watchServerLogActions();
		});
		afterEach(function() {
			clearInterval(instance._playerCheckInterval);
		});
		function emitAction(action, message) {
			instance.server.emit("output", { type: "action", action, message }, "");
		}
		it("should record a normal JOIN action", function() {
			emitAction("JOIN", "player joined the game");
			assert(instance.playersOnline.has("player"), "player was not added");
		});
		it("should parse the reason of a normal BAN action", function() {
			emitAction("BAN", "player was banned by <server>. Reason: griefing.");
			assert.deepEqual(
				connector.sentMessages[0],
				new lib.MessageEvent(
					1, src, addr("allInstances"), "InstanceBanlistUpdateEvent",
					new lib.InstanceBanlistUpdateEvent("player", true, "griefing"),
				),
			);
		});
		it("should not throw on a BAN action without a reason tail", function() {
			assert.doesNotThrow(() => emitAction("BAN", "evil"));
		});
		it("should not throw on an action whose message starts with a space", function() {
			assert.doesNotThrow(() => emitAction("JOIN", " "));
		});
	});
});
