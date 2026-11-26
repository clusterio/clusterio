import assert from "node:assert/strict";
import dgram from "node:dgram";
import events from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as lib from "@clusterio/lib";
import Host, { _discoverInstances, HostRouter } from "@clusterio/host/dist/node/src/Host.js";
import Instance from "@clusterio/host/dist/node/src/Instance.js";
import { HostConnector } from "@clusterio/host/dist/node/host.js";
import { MockServer } from "../mock.js";
import { computePluginStatuses } from "../../packages/web_ui/src/util/plugin_status.ts";
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

	describe("class HostRouter", function() {
		describe(".wakeInstance()", function() {
			it("should log the message of a start error that has no stack", async function() {
				const err = new lib.ConflictError("No available port left to assign from host.factorio_port_range");
				err.stack = undefined;
				const mockHost = {
					_shuttingDown: false,
					_connectInstance: async () => { throw err; },
					instanceLogMeta: () => ({}),
				};
				const responses = [];
				const origin = { connector: { sendResponseError: response => responses.push(response) } };
				const message = { dst: lib.Address.fromShorthand({ instanceId: 1 }) };
				const logged = [];
				const originalError = lib.logger.error;
				lib.logger.error = text => { logged.push(text); };
				try {
					new HostRouter(mockHost).wakeInstance(origin, message);
					await new Promise(resolve => setImmediate(resolve));
				} finally {
					lib.logger.error = originalError;
				}
				assert.equal(responses.length, 1);
				assert.equal(responses[0].code, "ConflictError");
				assert.equal(logged.length, 1);
				assert.match(logged[0], /No available port left to assign/);
			});
		});
	});
	describe("class Host", function() {
		describe(".fromConfig()", function() {
			const modsDirectory = path.join("temp", "test", "host_from_config", "mods");
			beforeEach(async function() {
				await fs.rm(path.dirname(modsDirectory), { recursive: true, force: true });
			});
			it("should create the mods directory and load the mod store", async function() {
				const hostConfig = new lib.HostConfig("host", { "host.mods_directory": modsDirectory });
				const host = await Host.fromConfig(hostConfig, [], new HostConnector(hostConfig, []), true, false);
				assert(host instanceof Host);
				assert.equal(host.canRestart, true);
				assert.equal(host.recoveryMode, false);
				assert.equal(host.modStore.modsDirectory, modsDirectory);
				await fs.access(modsDirectory);
			});
		});
		describe("._connectInstance()", function() {
			const originalFromConfig = Instance.fromConfig;
			afterEach(function() {
				Instance.fromConfig = originalFromConfig;
			});
			it("should reject a second start while the instance is starting", async function() {
				const hostConfig = new lib.HostConfig("host");
				const host = new Host(new HostConnector(hostConfig, []), hostConfig, []);
				const instanceConfig = new lib.InstanceConfig("host", { "instance.id": 7 });
				host.assignedInstances.set(7, { path: "dir", config: instanceConfig });
				let fail;
				Instance.fromConfig = () => new Promise((resolve, reject) => { fail = reject; });

				const first = host._connectInstance(7);
				await assert.rejects(host._connectInstance(7), /Instance with ID 7 is running/);
				assert.equal(host.instanceStatus(7), "starting");

				fail(new Error("start failed"));
				await assert.rejects(first, /start failed/);
				assert.equal(host.instanceStatus(7), "stopped");
				assert.equal(host.instanceConnections.has(7), false);
			});
			it("should reject while the host is shutting down", async function() {
				const hostConfig = new lib.HostConfig("host");
				const host = new Host(new HostConnector(hostConfig, []), hostConfig, []);
				host.assignedInstances.set(7, { path: "dir", config: new lib.InstanceConfig("host") });
				host._shuttingDown = true;
				await assert.rejects(host._connectInstance(7), /Host is shutting down/);
			});
		});
		describe("stopping instances", function() {
			const originalFromConfig = Instance.fromConfig;
			let host;
			let created;
			let stops;
			let release;
			const instanceDir = path.join("temp", "test", "host_stop_instances");
			beforeEach(async function() {
				await fs.mkdir(instanceDir, { recursive: true });
				const hostConfig = new lib.HostConfig("host");
				host = new Host(new HostConnector(hostConfig, []), hostConfig, []);
				host.send = () => {};
				host.connector.forward = () => {};
				for (const id of [7, 8]) {
					const config = new lib.InstanceConfig("host", { "instance.id": id, "instance.name": `i${id}` });
					host.assignedInstances.set(id, { path: instanceDir, config });
				}
				created = new Map();
				stops = [];
				release = undefined;
				Instance.fromConfig = async (config, fromHost, connector) => {
					await new Promise(resolve => { release = resolve; });
					const instance = new Instance(fromHost, connector, instanceDir, config, new MockServer());
					instance._status = "starting";
					instance.writeServerSettings = async () => {};
					instance.sendSaveListUpdate = async () => {};
					instance.prepare = async () => {};
					instance.prepareSave = async () => "save.zip";
					instance.start = async () => {
						instance.server._state = "running";
						instance.notifyStatus("running");
					};
					instance.server.stop = async () => {
						stops.push(instance.id);
						instance.notifyExit();
					};
					created.set(instance.id, instance);
					return instance;
				};
			});
			afterEach(function() {
				Instance.fromConfig = originalFromConfig;
			});
			async function connect(id) {
				const connecting = host._connectInstance(id);
				await wait(1);
				release();
				return (await connecting).instance;
			}
			function wait(ms) {
				return new Promise(resolve => setTimeout(resolve, ms));
			}
			/** Start an instance and hold it in prepare until the returned function is called */
			async function startHeld(id) {
				const instance = await connect(id);
				let finishPrepare;
				instance.prepare = () => new Promise(resolve => { finishPrepare = resolve; });
				const started = instance._startSave();
				await wait(1);
				return async () => { finishPrepare(); await started; };
			}

			describe(".instanceStatus()", function() {
				it("should report the status of a connected instance", async function() {
					const instance = await connect(7);
					instance.notifyStatus("exporting_data");
					assert.equal(host.instanceStatus(7), "exporting_data");
					assert.equal(host.instanceStatus(8), "stopped");
				});
			});
			describe(".handleInstanceUnassignInternalRequest()", function() {
				it("should stop an instance once a pending start connects and runs", async function() {
					const connecting = host._connectInstance(7);
					await wait(1);
					const unassigned = host.handleInstanceUnassignInternalRequest(
						new lib.InstanceUnassignInternalRequest(7)
					);
					release();
					const { instance } = await connecting;
					await instance._startSave();
					await unassigned;
					assert.deepEqual(stops, [7]);
					assert.equal(instance.status, "stopped");
					assert.equal(host.assignedInstances.has(7), false);
				});
				it("should unassign when a pending start fails", async function() {
					Instance.fromConfig = async () => { throw new Error("download failed"); };
					const connecting = host._connectInstance(7);
					const unassigned = host.handleInstanceUnassignInternalRequest(
						new lib.InstanceUnassignInternalRequest(7)
					);
					await assert.rejects(connecting, /download failed/);
					await unassigned;
					assert.equal(host.assignedInstances.has(7), false);
				});
				async function stopsOnceSettled(status) {
					const instance = await connect(7);
					instance.server._state = "running";
					instance.notifyStatus(status);
					const unassigned = host.handleInstanceUnassignInternalRequest(
						new lib.InstanceUnassignInternalRequest(7)
					);
					await wait(1);
					assert.equal(host.assignedInstances.has(7), true, "unassigned before settling");
					instance.notifyStatus("running");
					await unassigned;
					assert.deepEqual(stops, [7]);
					assert.equal(host.assignedInstances.has(7), false);
				}
				it("should stop an instance once creating_save finishes", async function() {
					await stopsOnceSettled("creating_save");
				});
				it("should stop an instance once exporting_data finishes", async function() {
					await stopsOnceSettled("exporting_data");
				});
				it("should stop an instance still preparing to start", async function() {
					const finish = await startHeld(7);
					const unassigned = host.handleInstanceUnassignInternalRequest(
						new lib.InstanceUnassignInternalRequest(7)
					);
					await finish();
					await unassigned;
					assert.deepEqual(stops, [7]);
					assert.equal(created.get(7).status, "stopped");
				});
				it("should unassign a stopped instance", async function() {
					await host.handleInstanceUnassignInternalRequest(new lib.InstanceUnassignInternalRequest(7));
					assert.equal(host.assignedInstances.has(7), false);
					assert.deepEqual(stops, []);
				});
			});
			describe(".shutdown()", function() {
				it("should stop an instance shut down while preparing to start", async function() {
					const finish = await startHeld(7);
					const shutdown = host.shutdown();
					await finish();
					await shutdown;
					assert.deepEqual(stops, [7]);
					assert.equal(created.get(7).status, "stopped");
				});
				it("should wait for pending starts and stop running instances", async function() {
					const running = await connect(7);
					await running._startSave();
					const connecting = host._connectInstance(8);
					await wait(1);
					const shutdown = host.shutdown();
					await wait(1);
					assert.deepEqual(stops, [7]);
					release();
					await (await connecting).instance._startSave().catch(() => {});
					await shutdown;
					assert.deepEqual(stops, [7, 8]);
				});
				it("should log errors stopping an instance and carry on", async function() {
					const instance = await connect(7);
					await instance._startSave();
					instance.server.stop = async () => { throw new Error("stop failed"); };
					const logged = [];
					const originalError = lib.logger.error;
					lib.logger.error = text => { logged.push(text); };
					try {
						await host.shutdown();
					} finally {
						lib.logger.error = originalError;
					}
					assert.equal(logged.length, 1);
					assert.match(logged[0], /stop failed/);
				});
			});
		});
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
		describe(".loadPlugins()", function() {
			let dir;
			before(async function() {
				lib.addPluginConfigFields([
					{ name: "host_wait_early", version: "1.0.0", hostEntrypoint: "x" },
					{ name: "host_wait_late", version: "1.0.0", hostEntrypoint: "x" },
				]);
				dir = await fs.mkdtemp(path.join(os.tmpdir(), "clusterio-host-wait-"));
				await fs.writeFile(path.join(dir, "early.js"), `export default async function({ host, plugins }) {
					host.lateApi = await plugins.waitFor("host_wait_late");
				}`);
				await fs.writeFile(path.join(dir, "late.js"), "export default function() { return { late: true }; }");
			});
			after(async function() {
				for (const name of Object.keys(lib.HostConfig.fieldDefinitions)) {
					if (name.startsWith("host_wait_")) {
						delete lib.HostConfig.fieldDefinitions[name];
					}
				}
				await fs.rm(dir, { recursive: true, force: true });
			});
			it("should let plugins wait for each other", async function() {
				const pluginInfos = [["host_wait_early", "early.js"], ["host_wait_late", "late.js"]].map(
					([name, hostEntrypoint]) => ({
						name, hostEntrypoint, packagePath: path.resolve(dir, "package.json"),
					})
				);
				const hostConfig = new lib.HostConfig("host");
				const host = new Host(new HostConnector(hostConfig, pluginInfos), hostConfig, pluginInfos);
				await host.loadPlugins();
				assert.deepEqual(host.lateApi, { late: true });
				assert.deepEqual([...host.loadedPlugins].map(p => p.name), ["host_wait_early", "host_wait_late"]);
			});
		});
		describe(".assignFreeGamePort()", function() {
			let host;
			let held;
			let instanceConfig;
			beforeEach(async function() {
				const hostConfig = new lib.HostConfig("host");
				host = new Host(new HostConnector(hostConfig, []), hostConfig, []);
				instanceConfig = new lib.InstanceConfig("host", { "instance.id": 1 });
				host.assignedInstances.set(1, { config: instanceConfig, path: "" });
				held = dgram.createSocket("udp4");
				held.bind(0, "127.0.0.1");
				await events.once(held, "listening");
			});
			afterEach(function() {
				held.close();
			});
			it("replaces a stored port another process is bound to", async function() {
				const port = held.address().port;
				host.config.set("host.factorio_port_range", `${port}-${port + 1}`);
				instanceConfig.set("factorio.host_assigned_game_port", port);
				assert.equal(await host.assignFreeGamePort(1), port + 1);
				assert.equal(instanceConfig.get("factorio.host_assigned_game_port"), port + 1);
			});
			it("keeps a stored port that is free", async function() {
				const port = held.address().port;
				host.config.set("host.factorio_port_range", `${port}-${port + 1}`);
				instanceConfig.set("factorio.host_assigned_game_port", port + 1);
				assert.equal(await host.assignFreeGamePort(1), port + 1);
			});
			it("rejects when every port in the range is taken", async function() {
				host.config.set("host.factorio_port_range", String(held.address().port));
				await assert.rejects(
					host.assignFreeGamePort(1),
					/No available port left to assign from host.factorio_port_range \(1 in use by other processes\)/
				);
			});
		});
		describe(".handlePluginListRequest()", function() {
			it("does not expect a plugin without a host or instance entrypoint to load", async function() {
				lib.addPluginConfigFields([{ name: "controller_only", controllerEntrypoint: "controller.js" }]);
				const packagePath = fileURLToPath(import.meta.resolve("@clusterio/host/package.json"));
				const pluginInfos = [{
					name: "controller_only", title: "Controller only", version: "1.0.0",
					requirePath: path.dirname(packagePath), packagePath, controllerEntrypoint: "controller.js",
				}];
				// Listed the same before and after a restart, as the host never loads it
				for (let restart = 0; restart < 2; restart++) {
					const hostConfig = new lib.HostConfig("host");
					const host = new Host(new HostConnector(hostConfig, pluginInfos), hostConfig, pluginInfos);
					await host.loadPlugins();
					const plugins = await host.handlePluginListRequest(new lib.PluginListRequest());
					const plugin = plugins.find(candidate => candidate.name === "controller_only");
					assert.equal(plugin.state, "noEntrypoint");
					const [entry] = computePluginStatuses([
						{ name: "host", isController: false, address: { hostId: 1 }, plugins: [plugin] },
					]).get("controller_only").machines;
					assert.equal(entry.running, entry.afterRestart, "restart pending");
				}
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
			it("leaves the flag alone for a pinned version of an already loaded plugin", async function() {
				await host.handlePluginInstallRequest(new lib.PluginInstallRequest("restart_test@1.0.0"));
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
			it("rejects while a plugin install or update is running", async function() {
				// Held by another live process
				await fs.writeFile("npm-operation.lock", `${process.ppid}\n`);
				try {
					await assert.rejects(
						() => mockHost.handleHostRestartRequest(),
						/Cannot restart while a plugin install or update is running/
					);
				} finally {
					await fs.rm("npm-operation.lock", { force: true });
				}
				assert.equal(process.exitCode, undefined);
				assert.equal(mockHost.shutdownCalled, false);
			});
		});
	});
});
