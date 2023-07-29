"use strict";
const assert = require("assert").strict;
const path = require("path");

const lib = require("@clusterio/lib");
const Host = require("@clusterio/host/src/Host");

describe("Host testing", function() {
	before(function() {
		lib.InstanceConfig.finalize();
	});

	describe("discoverInstances()", function() {
		it("should discover test instance", async function() {
			let instancePath = path.join("test", "file", "instances");
			let instanceInfos = await Host._discoverInstances(instancePath);

			let referenceConfig = new lib.InstanceConfig("host");
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

	describe("class Host", function() {
		describe(".handleSyncUserListsEvent()", function() {
			let mockHost;
			beforeEach(function() {
				mockHost = {
					adminlist: new Set(),
					whitelist: new Set(),
					banlist: new Map(),
					broadcasts: [],
					broadcastEventToInstance(event) {
						this.broadcasts.push(event);
					},
					handleSyncUserListsEvent: Host.prototype.handleSyncUserListsEvent,
					syncLists(adminlist, banlist, whitelist) {
						return this.handleSyncUserListsEvent(
							new lib.SyncUserListsEvent(adminlist, banlist, whitelist)
						);
					},
				};
			});

			it("should broadcast new entries to adminlist", async function() {
				await mockHost.syncLists(["admin1"], [], []);
				await mockHost.syncLists(["admin1", "admin2"], [], []);

				assert.deepEqual(mockHost.broadcasts, [
					new lib.InstanceAdminlistUpdateEvent("admin1", true),
					new lib.InstanceAdminlistUpdateEvent("admin2", true),
				]);
			});

			it("should broadcast removals from adminlist", async function() {
				mockHost.adminlist.add("admin1").add("admin2");
				await mockHost.syncLists(["admin1"], [], []);
				assert.deepEqual(mockHost.broadcasts, [
					new lib.InstanceAdminlistUpdateEvent("admin2", false),
				]);
			});

			it("should broadcast new entries to whitelist", async function() {
				await mockHost.syncLists([], [], ["player1"]);
				await mockHost.syncLists([], [], ["player1", "player2"]);

				assert.deepEqual(mockHost.broadcasts, [
					new lib.InstanceWhitelistUpdateEvent("player1", true),
					new lib.InstanceWhitelistUpdateEvent("player2", true),
				]);
			});

			it("should broadcast removals from whitelist", async function() {
				mockHost.whitelist.add("player1").add("player2");
				await mockHost.syncLists([], [], ["player1"]);

				assert.deepEqual(mockHost.broadcasts, [
					new lib.InstanceWhitelistUpdateEvent("player2", false),
				]);
			});

			it("should broadcast new entries to banlist", async function() {
				await mockHost.syncLists([], [["badie1", "greifing"]], []);
				await mockHost.syncLists([], [["badie1", "greifing"], ["badie2", "annoying"]], []);

				assert.deepEqual(mockHost.broadcasts, [
					new lib.InstanceBanlistUpdateEvent("badie1", true, "greifing"),
					new lib.InstanceBanlistUpdateEvent("badie2", true, "annoying"),
				]);
			});

			it("should broadcast removals to banlist", async function() {
				mockHost.banlist.set("badie1", "greifing").set("badie2", "annoying");
				await mockHost.syncLists([], [["badie1", "greifing"]], []);

				assert.deepEqual(mockHost.broadcasts, [
					new lib.InstanceBanlistUpdateEvent("badie2", false, ""),
				]);
			});
		});
	});
});
