"use strict";
const assert = require("assert").strict;
const path = require("path");

const libConfig = require("@clusterio/lib/config");
const Slave = require("@clusterio/slave/src/Slave");

describe("Slave testing", function() {
	before(function() {
		libConfig.InstanceConfig.finalize();
	});

	describe("discoverInstances()", function() {
		it("should discover test instance", async function() {
			let instancePath = path.join("test", "file", "instances");
			let instanceInfos = await Slave._discoverInstances(instancePath);

			let referenceConfig = new libConfig.InstanceConfig("slave");
			await referenceConfig.init();
			referenceConfig.set("instance.id", 1);
			referenceConfig.set("instance.name", "test");

			assert.deepEqual(instanceInfos, new Map([
				[1, {
					config: referenceConfig,
					path: path.join(instancePath, "test"),
				}],
			]));
		});
	});

	describe("class Slave", function() {
		describe(".syncUserListsEventHandler()", function() {
			let mockSlave;
			beforeEach(function() {
				mockSlave = {
					adminlist: new Set(),
					whitelist: new Set(),
					banlist: new Map(),
					broadcasts: [],
					broadcastEventToInstance(message, event) {
						this.broadcasts.push(message["data"]);
					},
					syncUserListsEventHandler: Slave.prototype.syncUserListsEventHandler,
					syncLists(adminlist, banlist, whitelist) {
						return this.syncUserListsEventHandler({ "data": {
							"adminlist": adminlist,
							"banlist": banlist,
							"whitelist": whitelist,
						}});
					},
				};
			});

			it("should broadcast new entries to adminlist", async function() {
				await mockSlave.syncLists(["admin1"], [], []);
				await mockSlave.syncLists(["admin1", "admin2"], [], []);

				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "admin1", "admin": true },
					{ "name": "admin2", "admin": true },
				]);
			});

			it("should broadcast removals from adminlist", async function() {
				mockSlave.adminlist.add("admin1").add("admin2");
				await mockSlave.syncLists(["admin1"], [], []);
				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "admin2", "admin": false },
				]);
			});

			it("should broadcast new entries to whitelist", async function() {
				await mockSlave.syncLists([], [], ["player1"]);
				await mockSlave.syncLists([], [], ["player1", "player2"]);

				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "player1", "whitelisted": true },
					{ "name": "player2", "whitelisted": true },
				]);
			});

			it("should broadcast removals from whitelist", async function() {
				mockSlave.whitelist.add("player1").add("player2");
				await mockSlave.syncLists([], [], ["player1"]);

				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "player2", "whitelisted": false },
				]);
			});

			it("should broadcast new entries to banlist", async function() {
				await mockSlave.syncLists([], [["badie1", "greifing"]], []);
				await mockSlave.syncLists([], [["badie1", "greifing"], ["badie2", "annoying"]], []);

				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "badie1", "banned": true, "reason": "greifing" },
					{ "name": "badie2", "banned": true, "reason": "annoying" },
				]);
			});

			it("should broadcast removals to banlist", async function() {
				mockSlave.banlist.set("badie1", "greifing").set("badie2", "annoying");
				await mockSlave.syncLists([], [["badie1", "greifing"]], []);

				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "badie2", "banned": false, "reason": "" },
				]);
			});
		});
	});
});
