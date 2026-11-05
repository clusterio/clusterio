import assert from "node:assert/strict";
import dgram from "node:dgram";
import events from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as lib from "@clusterio/lib";
import Host, { _discoverInstances, HostRouter } from "@clusterio/host/dist/node/src/Host.js";
import Instance from "@clusterio/host/dist/node/src/Instance.js";
import { HostConnector } from "@clusterio/host/dist/node/host.js";
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
				assert.equal(host._unconnectedStatus(7), "starting");

				fail(new Error("start failed"));
				await assert.rejects(first, /start failed/);
				assert.equal(host._unconnectedStatus(7), "stopped");
				assert.equal(host.instanceConnections.has(7), false);
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
		describe(".reserveInstancePorts()", function() {
			let host;
			let config;
			let held;
			let port;
			beforeEach(async function() {
				const hostConfig = new lib.HostConfig("host");
				host = new Host(new HostConnector(hostConfig, []), hostConfig, []);
				config = new lib.InstanceConfig("host", { "instance.id": 1, "instance.name": "inst1" });
				host.assignedInstances.set(1, { config, path: "" });
				// A port another process is bound to, the ports after it are used as a free range.
				held = dgram.createSocket("udp4");
				await events.once(held.bind(0, "127.0.0.1"), "listening");
				port = held.address().port;
			});
			afterEach(function() {
				held.close();
			});
			function setRange(first, last = first) {
				host.config.set("host.factorio_port_range", first === last ? String(first) : `${first}-${last}`);
			}
			function assign(id, fields = {}) {
				const other = new lib.InstanceConfig("host", { "instance.id": id, ...fields });
				host.assignedInstances.set(id, { config: other, path: "" });
				host._updatePortClaims(id, other);
			}
			function reservedPorts(id) {
				return Object.fromEntries(host.ports.reserved(id).map(claim => [claim.endpoint, claim.port]));
			}

			it("uses fixed ports as is and picks the rest", async function() {
				setRange(port + 1);
				config.set("factorio.rcon_port", 1000);
				config.set("factorio.enable_lua_udp", true);
				const ports = await host.reserveInstancePorts(1);
				assert.equal(ports.game, port + 1);
				assert.equal(ports.rcon, 1000);
				assert(ports.luaUdp.factorio > 0 && ports.luaUdp.host > 0);
				assert.notEqual(ports.luaUdp.factorio, ports.luaUdp.host);
				assert.deepEqual(reservedPorts(1), {
					rcon: 1000, game: port + 1, lua_udp: ports.luaUdp.factorio, host_lua_udp: ports.luaUdp.host,
				});
			});
			it("picks a free port outside the range for game_port 0", async function() {
				setRange(port + 1);
				config.set("factorio.game_port", 0);
				const ports = await host.reserveInstancePorts(1);
				assert(ports.game > 0 && ports.game !== port + 1);
				assert.equal(config.get("factorio.host_assigned_game_port"), null);
			});
			it("has no Lua UDP ports when Lua UDP is disabled", async function() {
				setRange(port + 1);
				config.set("factorio.lua_udp_port", 40000);
				const ports = await host.reserveInstancePorts(1);
				assert.equal(ports.luaUdp, null);
				assert.deepEqual(Object.keys(reservedPorts(1)).sort(), ["game", "rcon"]);
			});
			it("rejects a fixed port reserved for another instance and keeps nothing", async function() {
				host.ports.reserveFixed(2, "rcon", "tcp", 1000);
				config.set("factorio.game_port", 34197);
				config.set("factorio.rcon_port", 1000);
				await assert.rejects(
					host.reserveInstancePorts(1),
					new lib.ConflictError(
						'Cannot use TCP port 1000 for the RCON port of instance "inst1" (ID 1), ' +
						"it is in use by the RCON port of instance 2"
					),
				);
				assert.deepEqual(host.ports.reserved(1), []);
			});
			it("releases the reserved ports if picking a free one fails", async function() {
				config.set("factorio.game_port", 34197);
				host.ports._probe = async () => { throw new Error("probe failed"); };
				await assert.rejects(host.reserveInstancePorts(1), /probe failed/);
				assert.deepEqual(host.ports.reserved(1), []);
			});

			describe("game port from host.factorio_port_range", function() {
				it("replaces a stored port another process is bound to", async function() {
					setRange(port, port + 1);
					config.set("factorio.host_assigned_game_port", port);
					assert.equal((await host.reserveInstancePorts(1)).game, port + 1);
					assert.equal(config.get("factorio.host_assigned_game_port"), port + 1);
				});
				it("keeps a stored port that is free", async function() {
					setRange(port + 1, port + 2);
					config.set("factorio.host_assigned_game_port", port + 2);
					assert.equal((await host.reserveInstancePorts(1)).game, port + 2);
				});
				it("rejects when every port in the range is taken", async function() {
					setRange(port);
					await assert.rejects(
						host.reserveInstancePorts(1),
						new lib.ConflictError(
							'No free UDP port left in the range for the game port of instance "inst1" (ID 1) ' +
							"(1 in use by other processes)"
						),
					);
				});
				it("skips fixed UDP ports of stopped instances", async function() {
					setRange(port + 1, port + 3);
					assign(2, { "factorio.game_port": port + 1 });
					assign(3, { "factorio.enable_lua_udp": true, "factorio.lua_udp_port": port + 2 });
					assert.equal((await host.reserveInstancePorts(1)).game, port + 3);
				});
				it("skips ports reserved for running instances", async function() {
					setRange(port + 1, port + 2);
					config.set("factorio.host_assigned_game_port", port + 1);
					host.ports.reserveFixed(2, "lua_udp", "udp", port + 1);
					assert.equal((await host.reserveInstancePorts(1)).game, port + 2);
				});
				it("does not skip ports only used by TCP", async function() {
					setRange(port + 1);
					host.ports.reserveFixed(2, "rcon", "tcp", port + 1);
					assert.equal((await host.reserveInstancePorts(1)).game, port + 1);
				});
				it("gives concurrent starts different ports", async function() {
					setRange(port + 1, port + 2);
					assign(2);
					const ports = await Promise.all([host.reserveInstancePorts(1), host.reserveInstancePorts(2)]);
					assert.deepEqual(ports.map(p => p.game).sort(), [port + 1, port + 2]);
				});
				it("ignores instances that are discovered but not assigned", async function() {
					setRange(port + 1);
					host.discoveredInstances.set(2, {
						config: new lib.InstanceConfig("host", { "instance.id": 2, "factorio.game_port": port + 1 }),
						path: "",
					});
					assert.equal((await host.reserveInstancePorts(1)).game, port + 1);
				});
			});
		});
		describe(".ports", function() {
			const instancesDir = path.join("temp", "test", "host_ports");
			let host;
			let warnings;
			let originalWarn;
			beforeEach(async function() {
				await fs.rm(instancesDir, { recursive: true, force: true });
				await fs.mkdir(instancesDir, { recursive: true });
				const hostConfig = new lib.HostConfig("host", { "host.instances_directory": instancesDir });
				host = new Host(new HostConnector(hostConfig, []), hostConfig, []);
				host.send = async () => {};
				warnings = [];
				originalWarn = lib.logger.warn;
				lib.logger.warn = text => { warnings.push(text); };
			});
			afterEach(function() {
				lib.logger.warn = originalWarn;
			});
			function assign(id, fields = {}) {
				const config = new lib.InstanceConfig("controller", {
					"instance.id": id, "instance.name": `inst${id}`, ...fields,
				});
				return host.handleInstanceAssignInternalRequest(
					new lib.InstanceAssignInternalRequest(id, config.toRemote("host"))
				);
			}

			it("claims the fixed ports of an assigned stopped instance", async function() {
				await assign(1, { "factorio.rcon_port": 1000, "factorio.game_port": 34197 });
				assert(host.ports.isClaimed("tcp", 1000));
				assert(host.ports.isClaimed("udp", 34197));
				assert(!host.ports.isClaimed("udp", 1000));
			});
			it("updates claims when the config is replaced", async function() {
				await assign(1, { "factorio.rcon_port": 1000 });
				await assign(1, { "factorio.rcon_port": 2000 });
				assert(!host.ports.isClaimed("tcp", 1000));
				assert(host.ports.isClaimed("tcp", 2000));
			});
			it("removes claims when unassigned", async function() {
				await assign(1, { "factorio.rcon_port": 1000 });
				await host.handleInstanceUnassignInternalRequest(new lib.InstanceUnassignInternalRequest(1));
				assert(!host.ports.isClaimed("tcp", 1000));
			});
			it("does not claim ports from stale instance files on rediscovery", async function() {
				await assign(1, { "factorio.rcon_port": 1000 });
				await host.handleInstanceUnassignInternalRequest(new lib.InstanceUnassignInternalRequest(1));
				await host.updateInstances();
				assert(host.discoveredInstances.has(1), "instance file was not rediscovered");
				assert(!host.ports.isClaimed("tcp", 1000));
			});
			it("keeps claims of assigned instances on rediscovery", async function() {
				await assign(1, { "factorio.rcon_port": 1000 });
				await host.updateInstances();
				assert(host.ports.isClaimed("tcp", 1000));
			});
			it("warns with owner and endpoint when a fixed port is configured on two instances", async function() {
				await assign(1, { "factorio.rcon_port": 1000 });
				await assign(2, { "factorio.rcon_port": 1000 });
				assert.deepEqual(warnings, [
					'factorio.rcon_port 1000 (TCP) is also the RCON port of instance "inst1" (ID 1), ' +
					"only one of them can be running",
				]);
				await assign(2, { "factorio.rcon_port": 1000 });
				assert.equal(warnings.length, 1);
			});
			it("names running instances that are no longer assigned", function() {
				host.instanceConnections.set(3, { instance: { config: new lib.InstanceConfig("host", {
					"instance.id": 3, "instance.name": "leaving",
				}) } });
				assert.equal(host.ports.describeOwner(3), 'instance "leaving" (ID 3)');
				assert.equal(host.ports.describeOwner(4), "instance 4");
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
