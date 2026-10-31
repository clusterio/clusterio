import assert from "node:assert/strict";
import events from "node:events";
import * as lib from "@clusterio/lib";
import {
	Controller, ControlConnection, ControllerHooks, HostConnection, HostRecord, InstanceManager, InstanceRecord,
} from "@clusterio/controller";
import { MockConnector, MockController, MockLogger } from "../mock.js";
import "../setup_logging.js";

const addr = lib.Address.fromShorthand;

describe("controller/src/ControlConnection", function() {
	describe(".handleDebugDumpWsRequest()", function() {
		function makeConnection() {
			const controllerConfig = new lib.ControllerConfig("controller");
			const connector = new lib.VirtualConnector(
				lib.Address.fromShorthand("controller"),
				lib.Address.fromShorthand({ controlId: 1 }),
			);
			connector._socket = {};
			const controller = new Controller(lib.logger, [], controllerConfig);
			const user = controller.users.getOrCreateUser("test");
			return new ControlConnection({ version: "2.0.0" }, connector, controller, user, 1);
		}

		it("re-applies clusterio_ignore_dump to the socket on resume", async function() {
			const connection = makeConnection();
			await connection.handleDebugDumpWsRequest(new lib.DebugDumpWsRequest());
			// A resume installs a fresh socket without the flag.
			const resumedSocket = {};
			connection.connector._socket = resumedSocket;
			connection.connector.emit("resume");
			assert.equal(resumedSocket.clusterio_ignore_dump, true);
		});

		it("leaves the flag off on resume without a dumper", function() {
			const connection = makeConnection();
			const resumedSocket = {};
			connection.connector._socket = resumedSocket;
			connection.connector.emit("resume");
			assert.equal(resumedSocket.clusterio_ignore_dump, false);
		});
	});

	describe(".handleControllerRestartRequest()", function() {
		let mockController;

		beforeEach(function() {
			mockController = {
				canRestart: true,
				shouldRestart: false,
				stopped: false,
				async checkRestartDowngrade() { return null; },
				stop() { this.stopped = true; },
			};
		});

		async function restart() {
			await ControlConnection.prototype.handleControllerRestartRequest.call({
				_controller: mockController,
			});
		}

		it("restarts when the installed version is not older", async function() {
			await restart();
			assert.equal(mockController.shouldRestart, true);
			assert.equal(mockController.stopped, true);
		});

		it("rejects a downgrade without stopping the controller", async function() {
			mockController.checkRestartDowngrade = async () => ({
				installedVersion: "1.0.0",
				runningVersion: "2.0.0",
			});

			await assert.rejects(restart, /Stop the controller before starting the older version manually/);
			assert.equal(mockController.shouldRestart, false);
			assert.equal(mockController.stopped, false);
		});
	});

	describe(".handlePluginInstallRequest()", function() {
		let mockController;
		let _fetch;

		beforeEach(function() {
			mockController = {
				config: new lib.ControllerConfig("controller", { "controller.allow_plugin_install": true }),
				pluginInfos: [{ name: "restart_test", npmPackage: "restart_test", version: "1.0.0" }],
			};
			_fetch = global.fetch;
			global.fetch = async () => ({ ok: true });
		});
		afterEach(function() {
			global.fetch = _fetch;
		});

		async function install(name) {
			await ControlConnection.prototype.handlePluginInstallRequest.call(
				{ _controller: mockController },
				new lib.PluginInstallRequest(name),
			);
		}

		it("marks a restart as required for a new plugin", async function() {
			await install("new_plugin");
			assert.equal(mockController.config.restartRequired, true);
		});
		it("leaves the flag alone for an already loaded plugin", async function() {
			await install("restart_test");
			assert.equal(mockController.config.restartRequired, false);
		});
		it("leaves the flag alone for a pinned version of an already loaded plugin", async function() {
			await install("restart_test@1.0.0");
			assert.equal(mockController.config.restartRequired, false);
		});
		it("rejects when installs are disabled", async function() {
			mockController.config = new lib.ControllerConfig(
				"controller", { "controller.allow_plugin_install": false }
			);
			await assert.rejects(install("new_plugin"), /Plugin installs are disabled/);
			assert.equal(mockController.config.restartRequired, false);
		});
	});

	describe(".handleInstanceCreateRequest()", function() {
		let mockController;

		beforeEach(function() {
			mockController = new MockController();
			mockController.mockConfigEntries.set("controller.name", "Test");
			mockController.instances = new InstanceManager(new lib.SubscribableDatastore(), mockController);
		});

		async function create(config, cloneFromId) {
			await ControlConnection.prototype.handleInstanceCreateRequest.call(
				{ _controller: mockController },
				new lib.InstanceCreateRequest(config, cloneFromId),
			);
		}

		it("rejects instance.assigned_host in the config", async function() {
			await assert.rejects(
				create({ "instance.id": 4001, "instance.name": "c1", "instance.assigned_host": 10 }),
				new lib.ValidationError("instance.assigned_host must be set through the assign-host interface"),
			);
			assert.equal(mockController.instances.has(4001), false);
		});

		it("creates an unassigned clone of an assigned instance", async function() {
			await create({ "instance.id": 4001, "instance.name": "base" });
			mockController.instances.getMutable(4001).config.set("instance.assigned_host", 10);

			await create({ "instance.id": 4002, "instance.name": "clone", "instance.assigned_host": null }, 4001);
			const clone = mockController.instances.get(4002);
			assert.equal(clone.config.get("instance.name"), "clone");
			assert.equal(clone.config.get("instance.assigned_host"), null);
		});
	});

	describe("close cleanup", function() {
		let connector;
		let mockController;
		let connection;

		beforeEach(function() {
			connector = new MockConnector(addr("controller"), addr({ controlId: 1 }));
			connector._socket = {};
			const transports = new Set();
			mockController = {
				hooks: new ControllerHooks(new MockLogger()),
				router: null,
				_registeredRequests: new Map(),
				_fallbackedRequests: new Map(),
				_registeredEvents: new Map(),
				_snoopedEvents: new Map(),
				subscriptions: { unsubscribeLink() {} },
				clusterLogger: {
					transports,
					add(transport) { transports.add(transport); },
					remove(transport) { transports.delete(transport); },
				},
				debugEvents: new events.EventEmitter(),
				sendRequestToHostByInstanceId() {},
			};
			connection = new ControlConnection({ version: "test" }, connector, mockController, {}, 1);
		});

		it("removes the log transport from clusterLogger", async function() {
			await connection.handleLogSetSubscriptionsRequest(
				new lib.LogSetSubscriptionsRequest(true, false, [], [])
			);
			assert.equal(mockController.clusterLogger.transports.size, 1);
			connector.emit("close");
			assert.equal(mockController.clusterLogger.transports.size, 0);
			assert.equal(connection.logTransport, null);
		});

		it("stops following logs when the user loses permission", async function() {
			await connection.handleLogSetSubscriptionsRequest(
				new lib.LogSetSubscriptionsRequest(true, false, [], [])
			);
			connection.user = { checkPermission() { throw new lib.PermissionError("Permission denied"); } };
			connection.checkLogPermission();
			assert.equal(mockController.clusterLogger.transports.size, 0);
			assert.equal(connection.logTransport, null);
		});

		it("keeps following logs when the user has permission", async function() {
			await connection.handleLogSetSubscriptionsRequest(
				new lib.LogSetSubscriptionsRequest(true, false, [], [])
			);
			connection.user = { checkPermission() {} };
			connection.checkLogPermission();
			assert.equal(mockController.clusterLogger.transports.size, 1);
		});

		it("removes the debug dump listener after repeated requests", async function() {
			await connection.handleDebugDumpWsRequest(new lib.DebugDumpWsRequest());
			await connection.handleDebugDumpWsRequest(new lib.DebugDumpWsRequest());
			assert.equal(mockController.debugEvents.listenerCount("message"), 1);
			assert.equal(connector._socket.clusterio_ignore_dump, true);
			connector.emit("close");
			assert.equal(mockController.debugEvents.listenerCount("message"), 0);
		});
	});

	describe(".handleUserDeleteRequest()", function() {
		let mockController;
		let nextId;

		beforeEach(function() {
			mockController = new MockController();
			mockController.sendTo = () => {};
			mockController.wsServer.controlConnections = new Map();
			nextId = 1;
		});

		function connect(name) {
			const connection = {
				_controller: mockController,
				user: mockController.users.getByName(name),
				connector: {
					terminated: false,
					terminate() { this.terminated = true; },
				},
			};
			mockController.wsServer.controlConnections.set(nextId, connection);
			nextId += 1;
			return connection;
		}

		async function deleteUser(connection, name) {
			await ControlConnection.prototype.handleUserDeleteRequest.call(
				connection, new lib.UserDeleteRequest(name)
			);
		}

		it("terminates connections of the deleted user", async function() {
			const admin = connect("test");
			const player1 = connect("player");
			const player2 = connect("player");

			await deleteUser(admin, "player");
			assert.equal(mockController.users.getByName("player"), undefined);
			assert.equal(player1.connector.terminated, true);
			assert.equal(player2.connector.terminated, true);
			assert.equal(admin.connector.terminated, false);
		});

		it("terminates its own connection when deleting itself", async function() {
			const player = connect("player");

			await deleteUser(player, "player");
			assert.equal(player.connector.terminated, true);
		});
	});

	describe("host management", function() {
		/** @type {Controller} */
		let controller;
		/** @type {ControlConnection} */
		let connection;
		let audits;
		let originalAudit;

		beforeEach(function() {
			const config = new lib.ControllerConfig("controller");
			config.set("controller.auth_secret", Buffer.from("TestSecretDoNotUse").toString("base64"));
			controller = new Controller(lib.logger, [], config);
			const connector = new lib.VirtualConnector(addr("controller"), addr({ controlId: 1 }));
			const user = controller.users.getOrCreateUser("admin");
			connection = new ControlConnection({ version: "2.0.0" }, connector, controller, user, 1);
			audits = [];
			originalAudit = lib.logger.audit;
			lib.logger.audit = msg => { audits.push(msg); };
		});
		afterEach(function() {
			lib.logger.audit = originalAudit;
		});

		describe(".handleHostRevokeRequest()", function() {
			let record;
			let broadcasts;

			beforeEach(function() {
				record = new HostRecord(10, "host-10", "", new Map());
				controller.hosts.set(record);
				broadcasts = [];
				controller.subscriptions.broadcast = event => {
					if (event instanceof lib.HostUpdatesEvent) {
						broadcasts.push(...event.updates.map(host => ({ id: host.id, isDeleted: host.isDeleted })));
					}
				};
			});

			function assignInstance(id, name, hostId) {
				const instanceConfig = new lib.InstanceConfig("controller");
				instanceConfig.set("instance.id", id);
				instanceConfig.set("instance.name", name);
				instanceConfig.set("instance.assigned_host", hostId);
				controller.instances.records.set(new InstanceRecord(instanceConfig, "stopped"));
			}

			async function revoke(hostId = 10) {
				await connection.handleHostRevokeRequest(new lib.HostRevokeRequest(hostId));
			}

			it("deletes the host record", async function() {
				await revoke();
				assert.equal(controller.hosts.has(10), false);
				assert.deepEqual(broadcasts, [{ id: 10, isDeleted: true }]);
				assert.equal(audits.length, 1);
				assert.match(audits[0], /User admin revoked host host-10 \(10\)/);
			});
			it("deletes the note of the host", async function() {
				controller.setNote("host", "10", "rack 3", "someone");
				controller.setNote("host", "11", "rack 4", "someone");
				await revoke();
				const note = controller.notes.get("host/10");
				assert.equal(note.isDeleted, true);
				assert.equal(note.content, "");
				assert.equal(note.updatedBy, "admin");
				assert.equal(controller.notes.get("host/11").isDeleted, false);
			});
			it("terminates the connection of the host", async function() {
				let terminated = false;
				controller.wsServer.hostConnections.set(10, { connector: { terminate() { terminated = true; } } });
				await revoke();
				assert.equal(terminated, true);
			});
			it("does not leave a host record behind when the connection closes", async function() {
				const connector = new MockConnector(addr("controller"), addr({ hostId: 10 }));
				connector.terminate = () => { connector.emit("close"); };
				const hostConnection = new HostConnection(
					new lib.RegisterHostData("", "2.0.0", 10, {}), connector, controller, "10.0.0.1"
				);
				controller.wsServer.hostConnections.set(10, hostConnection);
				assert.equal(controller.hosts.get(10).connected, true);

				await revoke();
				assert.equal(controller.hosts.has(10), false, "host record was recreated");
				assert.deepEqual(broadcasts.at(-1), { id: 10, isDeleted: true });
			});
			it("unassigns the instances of the host without waiting for it", async function() {
				let closing = false;
				controller.wsServer.hostConnections.set(10, {
					connector: { terminate() { closing = true; }, get closing() { return closing; } },
					send: () => new Promise(() => {}),
				});
				assignInstance(101, "alpha", 10);
				assignInstance(102, "beta", 10);
				assignInstance(201, "gamma", 20);

				await revoke();
				assert.equal(controller.hosts.has(10), false);
				for (const id of [101, 102]) {
					const instance = controller.instances.get(id);
					assert.equal(instance.config.get("instance.assigned_host"), null);
					assert.equal(instance.status, "unassigned");
				}
				assert.equal(controller.instances.get(201).config.get("instance.assigned_host"), 20);
			});
			it("removes the system metrics of the host", async function() {
				controller.systems.set(await lib.gatherSystemInfo(10, false, false, 0));
				controller.systems.set(await lib.gatherSystemInfo("controller", false, false, 0));
				await revoke();
				assert.equal(controller.systems.has(10), false);
				assert.equal(controller.systems.has("controller"), true);
			});
			it("throws NotFoundError for an unknown host", async function() {
				await assert.rejects(revoke(99), new lib.NotFoundError("Unknown host id (99)"));
				assert.equal(controller.hosts.has(10), true);
			});
		});

		describe("host pairing requests", function() {
			it("lists pending requests", async function() {
				const first = controller.hostPairing.create("Host A", "2.0.0", "10.0.0.1");
				const second = controller.hostPairing.create("Host B", "2.0.0", "10.0.0.2");
				const list = await connection.handleHostPairingListRequest(new lib.HostPairingListRequest());
				assert(list.every(details => details instanceof lib.HostPairingDetails));
				assert.deepEqual(list.map(details => details.code).sort(), [first.code, second.code].sort());
				assert.equal(list.find(details => details.code === first.code).name, "Host A");
			});
			it("leaves out expired, approved and rejected requests when listing", async function() {
				const expired = controller.hostPairing.create("Host A", "", "10.0.0.1");
				const approved = controller.hostPairing.create("Host B", "", "10.0.0.2");
				const rejected = controller.hostPairing.create("Host C", "", "10.0.0.3");
				const pending = controller.hostPairing.create("Host D", "", "10.0.0.4");
				controller.hostPairing._bySecret.get(expired.requestId).lastPollMs -= 60e3;
				controller.hostPairing.approve(approved.code, undefined, "admin");
				controller.hostPairing.reject(rejected.code, "admin");

				const list = await connection.handleHostPairingListRequest(new lib.HostPairingListRequest());
				assert.deepEqual(list.map(details => details.code), [pending.code]);
			});
			it("approves a request and returns the new host id", async function() {
				const { requestId, code } = controller.hostPairing.create("Host A", "", "10.0.0.1");
				const hostId = await connection.handleHostPairingApproveRequest(
					new lib.HostPairingApproveRequest(code.toLowerCase().replace("-", ""))
				);
				assert.equal(typeof hostId, "number");
				assert.equal(controller.hosts.get(hostId).name, "Host A");
				assert.equal(controller.hostPairing.poll(requestId).hostId, hostId);
				assert(audits.some(msg => msg.startsWith(`User admin approved host Host A (${hostId})`)));
			});
			it("rejects a request", async function() {
				const { requestId, code } = controller.hostPairing.create("Host A", "", "10.0.0.1");
				await connection.handleHostPairingRejectRequest(new lib.HostPairingRejectRequest(code.toLowerCase()));
				assert.equal(controller.hostPairing.records.has(code), false);
				assert.throws(() => controller.hostPairing.poll(requestId), /Request was rejected/);
				assert.equal(controller.hosts.size, 0);
				assert(audits.some(msg => msg.startsWith(`User admin rejected host Host A with code ${code}`)));
			});
		});
	});
});
