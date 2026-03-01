"use strict";
const assert = require("assert").strict;
const path = require("path");

const lib = require("@clusterio/lib");
const Host = require("@clusterio/host/dist/node/src/Host").default;
const Instance = require("@clusterio/host/dist/node/src/Instance").default;
const { _discoverInstances } = require("@clusterio/host/dist/node/src/Host");
const { HostConnector } = require("@clusterio/host/dist/node/host");

describe("Host testing", function() {
	describe("discoverInstances()", function() {
		it("should discover test instance", async function() {
			const instancePath = path.join("test", "file", "instances");
			const instances = await _discoverInstances(instancePath);

			const configPath = path.join(instancePath, "test", "instance.json");
			const referenceConfig = new lib.InstanceConfig("host", {
				...Host.instanceConfigWarning,
				"instance.id": 1,
				"instance.name": "test",
			}, configPath);

			assert.deepEqual(instances, new Map([
				[1, {
					config: referenceConfig,
					path: path.join(instancePath, "test"),
				}],
			]));
		});
	});

	describe("class Host", function() {
		describe(".handleSyncUserListsEvent()", function() {
			const hostAddress = lib.Address.fromShorthand({ hostId: 1 });
			const instanceAddress = lib.Address.fromShorthand({ instanceId: 1 });
			let mockHost, hostConnector, instanceConnector;
			before(function() {
				[hostConnector, instanceConnector] = lib.VirtualConnector.makePair(hostAddress, instanceAddress);
				instanceConnector.on("message", function(message) {
					Instance.prototype._validateMessage(message);
				});
			});
			beforeEach(function() {
				mockHost = {
					adminlist: new Set(),
					whitelist: new Set(),
					banlist: new Map(),
					broadcasts: [],
					broadcastEventToInstance(event) {
						this.broadcasts.push(event);
						hostConnector.sendEvent(event, instanceAddress);
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
		describe(".checkRestartRequired()", function() {
			let host;
			beforeEach(function() {
				// This can be used more generally, but i did not want to interfere with handleSyncUserListsEvent
				const hostVersion = require("@clusterio/host/package.json").version;
				const pluginInfos = [{
					name: "global_chat",
					requirePath: path.dirname(require.resolve("@clusterio/host/package.json")),
					version: hostVersion,
				}];
				const hostConfig = new lib.HostConfig("host", { "host.version": hostVersion });
				const hostConnector = new HostConnector(hostConfig, undefined, pluginInfos);
				host = new Host(hostConnector, hostConfig, undefined, pluginInfos);
			});
			it("returns false when no changes are present", async function() {
				host.pluginInfos[0].hostEntrypoint = true;
				host.pluginInfos[0].instanceEntrypoint = true;
				const result = await host.checkRestartRequired();
				assert.equal(result, false);
				assert.equal(host.config.restartRequired, false);
			});
			it("returns false when an unloaded plugin version changes", async function() {
				host.pluginInfos[0].version = "0.0.0";
				host.pluginInfos[0].hostEntrypoint = true;
				host.pluginInfos[0].instanceEntrypoint = true;
				host.config.set("global_chat.load_plugin", false);
				host.config.restartRequired = false; // Setting load_plugin requires a restart
				const result = await host.checkRestartRequired();
				assert.equal(result, false);
				assert.equal(host.config.restartRequired, false);
			});
			it("returns true when the config flag is set", async function() {
				host.config.restartRequired = true;
				const result = await host.checkRestartRequired();
				assert.equal(result, true);
				assert.equal(host.config.restartRequired, true);
			});
			it("returns true when clusterio version changes", async function() {
				host.config.set("host.version", "0.0.0");
				const result = await host.checkRestartRequired();
				assert.equal(result, true);
				assert.equal(host.config.restartRequired, true);
			});
			it("returns true when a host plugin version changes", async function() {
				host.pluginInfos[0].version = "0.0.0";
				host.pluginInfos[0].hostEntrypoint = true;
				const result = await host.checkRestartRequired();
				assert.equal(result, true);
				assert.equal(host.config.restartRequired, true);
			});
			it("returns true when an instance plugin version changes", async function() {
				host.pluginInfos[0].version = "0.0.0";
				host.pluginInfos[0].instanceEntrypoint = true;
				const result = await host.checkRestartRequired();
				assert.equal(result, true);
				assert.equal(host.config.restartRequired, true);
			});
		});
	});
});
