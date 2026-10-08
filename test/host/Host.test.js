import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as lib from "@clusterio/lib";
import Host, { _discoverInstances } from "@clusterio/host/dist/node/src/Host.js";
import Instance from "@clusterio/host/dist/node/src/Instance.js";
import { HostConnector } from "@clusterio/host/dist/node/host.js";
import "../setup_logging.js";

describe("host/src/Host", function() {
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
		describe(".checkRestartRequired()", async function() {
			let host;
			const hostVersion = (
				await import("@clusterio/host/package.json", { with: { type: "json" }})
			).default.version;
			before(function() {
				lib.addPluginConfigFields([{ name: "restart_test", hostEntrypoint: "host.js" }]);
			});
			beforeEach(function() {
				// This can be used more generally, but i did not want to interfere with handleSyncUserListsEvent
				const pluginInfos = [{
					name: "restart_test",
					packagePath: fileURLToPath(import.meta.resolve("@clusterio/host/package.json")),
					version: hostVersion,
				}];
				const hostConfig = new lib.HostConfig("host", { "host.version": hostVersion });
				const hostConnector = new HostConnector(hostConfig, pluginInfos);
				host = new Host(hostConnector, hostConfig, pluginInfos);
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
				host.config.set("restart_test.load_plugin", false);
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
		describe(".handlePluginInstallRequest()", function() {
			let host;
			let _fetch;
			beforeEach(function() {
				const pluginInfos = [{ name: "restart_test", npmPackage: "restart_test", version: "1.0.0" }];
				const hostConfig = new lib.HostConfig("host", { "host.allow_plugin_install": true });
				const hostConnector = new HostConnector(hostConfig, pluginInfos);
				host = new Host(hostConnector, hostConfig, pluginInfos);
				_fetch = global.fetch;
				global.fetch = async () => ({ ok: true });
			});
			afterEach(function() {
				global.fetch = _fetch;
			});
			it("marks a restart as required for a new plugin", async function() {
				await host.handlePluginInstallRequest(new lib.PluginInstallRequest("new_plugin"));
				assert.equal(host.config.restartRequired, true);
			});
			it("leaves the flag alone for an already loaded plugin", async function() {
				await host.handlePluginInstallRequest(new lib.PluginInstallRequest("restart_test"));
				assert.equal(host.config.restartRequired, false);
			});
			it("rejects when installs are disabled", async function() {
				host.config.set("host.allow_plugin_install", false);
				host.config.restartRequired = false; // Setting allow_plugin_install requires a restart
				await assert.rejects(
					host.handlePluginInstallRequest(new lib.PluginInstallRequest("new_plugin")),
					/Plugin installs are disabled/
				);
				assert.equal(host.config.restartRequired, false);
			});
		});
		describe(".checkRestartDowngrade()", async function() {
			let host;
			const hostVersion = (
				await import("@clusterio/host/package.json", { with: { type: "json" }})
			).default.version;
			beforeEach(function() {
				const hostConfig = new lib.HostConfig("host", { "host.version": hostVersion });
				const hostConnector = new HostConnector(hostConfig, []);
				host = new Host(hostConnector, hostConfig, []);
			});
			it("returns null when the installed version matches", async function() {
				assert.equal(await host.checkRestartDowngrade(), null);
			});
			it("returns null when the installed version is newer", async function() {
				host.config.set("host.version", "0.0.0");
				assert.equal(await host.checkRestartDowngrade(), null);
			});
			it("returns both versions when the installed version is older", async function() {
				host.config.set("host.version", "999.0.0");
				assert.deepEqual(await host.checkRestartDowngrade(), {
					installedVersion: hostVersion,
					runningVersion: "999.0.0",
				});
			});
		});
		describe(".handleInstanceAssignInternalRequest()", function() {
			const instancesDir = path.join("temp", "test", "host_assign");
			let host;
			beforeEach(async function() {
				await fs.rm(instancesDir, { recursive: true, force: true });
				await fs.mkdir(instancesDir, { recursive: true });
				const hostConfig = new lib.HostConfig("host", { "host.instances_directory": instancesDir });
				const hostConnector = new HostConnector(hostConfig, []);
				host = new Host(hostConnector, hostConfig, []);
				host.send = () => {};
			});
			function assignRequest(id, name) {
				const config = new lib.InstanceConfig("controller", { "instance.id": id, "instance.name": name });
				return new lib.InstanceAssignInternalRequest(id, config.toRemote("host"));
			}

			it("creates the folders for a new instance", async function() {
				await host.handleInstanceAssignInternalRequest(assignRequest(1, "new"));
				const instancePath = path.join(instancesDir, "new");
				assert.equal(host.discoveredInstances.get(1).path, instancePath);
				await fs.access(path.join(instancePath, "saves"));
				await fs.access(path.join(instancePath, "script-output"));
			});
			it("recreates missing folders for a discovered instance", async function() {
				const instancePath = path.join(instancesDir, "existing");
				await fs.mkdir(instancePath);
				const configPath = path.join(instancePath, "instance.json");
				host.discoveredInstances.set(2, {
					path: instancePath,
					config: new lib.InstanceConfig("host", {
						...Host.instanceConfigWarning,
						"instance.id": 2,
						"instance.name": "existing",
					}, configPath),
				});

				await host.handleInstanceAssignInternalRequest(assignRequest(2, "existing"));
				await fs.access(path.join(instancePath, "saves"));
				await fs.access(path.join(instancePath, "script-output"));
			});
		});
		describe(".handleHostRestartRequest()", function() {
			let mockHost;
			beforeEach(function() {
				process.exitCode = undefined;
				mockHost = {
					canRestart: true,
					shutdownCalled: false,
					async checkRestartDowngrade() { return null; },
					shutdown() { this.shutdownCalled = true; },
					handleHostRestartRequest: Host.prototype.handleHostRestartRequest,
				};
			});
			afterEach(function() {
				process.exitCode = undefined;
			});

			it("restarts when the installed version is not older", async function() {
				await mockHost.handleHostRestartRequest();
				assert.equal(process.exitCode, 1);
				assert.equal(mockHost.shutdownCalled, true);
			});
			it("rejects a downgrade without shutting down the host", async function() {
				mockHost.checkRestartDowngrade = async () => ({
					installedVersion: "1.0.0",
					runningVersion: "2.0.0",
				});

				await assert.rejects(
					() => mockHost.handleHostRestartRequest(),
					/Stop the host before starting the older version manually/
				);
				assert.equal(process.exitCode, undefined);
				assert.equal(mockHost.shutdownCalled, false);
			});
		});
	});
});
