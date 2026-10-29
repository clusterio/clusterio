import assert from "node:assert/strict";
import events from "node:events";
import * as lib from "@clusterio/lib";
import { Controller, ControlConnection, ControllerHooks, InstanceManager } from "@clusterio/controller";
import { MockConnector, MockController, MockLogger } from "../mock.js";

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

		it("creates an instance inheriting from a template", async function() {
			await create({ "instance.id": 4001, "instance.name": "template", "instance.is_template": true });
			mockController.instances.getMutable(4001).config.set("factorio.version", "2.0");

			await create({ "instance.id": 4002, "instance.name": "child", "instance.template_id": 4001 });
			const child = mockController.instances.get(4002);
			assert.equal(child.config.get("factorio.version"), "2.0");
			assert.equal(child.config.isInherited("factorio.version"), true);
			assert.equal(child.config.isInherited("instance.name"), false);
		});

		it("rejects a template that is not a template", async function() {
			await create({ "instance.id": 4001, "instance.name": "plain" });
			await assert.rejects(
				create({ "instance.id": 4002, "instance.name": "child", "instance.template_id": 4001 }),
				new lib.ValidationError("Instance plain is not a template"),
			);
			assert.equal(mockController.instances.has(4002), false);
		});
	});

	describe("instance config set handlers", function() {
		let mockController;
		let connection;

		beforeEach(async function() {
			mockController = new MockController();
			mockController.mockConfigEntries.set("controller.name", "Test");
			mockController.instances = new InstanceManager(new lib.SubscribableDatastore(), mockController);
			mockController.instanceConfigUpdated = async () => {};
			connection = {
				_controller: mockController,
				checkStagedInheritance: ControlConnection.prototype.checkStagedInheritance,
			};
			for (const [id, fields] of [
				[1, { "instance.is_template": true, "factorio.version": "2.0" }],
				[2, { "instance.template_id": 1 }],
			]) {
				const config = new lib.InstanceConfig("controller", {
					"instance.id": id, "instance.name": `i${id}`, ...fields,
				});
				if (fields["instance.template_id"]) {
					mockController.instances.applyTemplate(
						config, ["instance.id", "instance.name", "instance.template_id"],
					);
				}
				await mockController.instances.createInstance(config);
			}
		});

		function call(handler, request) {
			return ControlConnection.prototype[handler].call(connection, request);
		}
		async function create(config, cloneFromId) {
			await ControlConnection.prototype.handleInstanceCreateRequest.call(
				connection, new lib.InstanceCreateRequest(config, cloneFromId),
			);
		}
		const setField = (...args) => new lib.InstanceConfigSetFieldRequest(...args);
		const setFields = (...args) => new lib.InstanceConfigSetRequest(...args);

		it("stops inheriting a field set to the inherited value", async function() {
			await call("handleInstanceConfigSetFieldRequest", setField(2, "factorio.version", "2.0"));
			assert.equal(mockController.instances.get(2).config.isInherited("factorio.version"), false);
		});

		it("stops inheriting a field set through set request", async function() {
			await call("handleInstanceConfigSetRequest", setFields(2, { "factorio.version": "2.0" }));
			assert.equal(mockController.instances.get(2).config.isInherited("factorio.version"), false);
		});

		it("stops inheriting a property set through set-prop", async function() {
			await call(
				"handleInstanceConfigSetPropRequest",
				new lib.InstanceConfigSetPropRequest(2, "factorio.settings", "max_players", 0),
			);
			const config = mockController.instances.get(2).config;
			assert.equal(config.isInherited("factorio.settings", "max_players"), false);
			assert.equal(config.isInherited("factorio.settings", "auto_pause"), true);
		});

		it("rejects template_id pointing at a non-template", async function() {
			await assert.rejects(
				call("handleInstanceConfigSetFieldRequest", setField(1, "instance.template_id", "2")),
				new lib.ValidationError("Instance i2 is not a template"),
			);
			assert.equal(mockController.instances.get(1).config.get("instance.template_id"), null);
		});

		it("rejects unmarking a template with inheritors through set request", async function() {
			await assert.rejects(
				call("handleInstanceConfigSetRequest", setFields(1, { "instance.is_template": "false" })),
				new lib.ConflictError("Instance is the template of 1 other instance(s)"),
			);
			assert.equal(mockController.instances.get(1).config.get("instance.is_template"), true);
		});

		it("stops inheriting only the properties set through set request", async function() {
			await call("handleInstanceConfigSetRequest", setFields(2, { "factorio.settings": { max_players: 3 } }));
			const config = mockController.instances.get(2).config;
			assert.equal(config.isInherited("factorio.settings", "max_players"), false);
			assert.equal(config.isInherited("factorio.settings", "auto_pause"), true);
		});

		it("inherits a property again", async function() {
			await call("handleInstanceConfigSetPropRequest", new lib.InstanceConfigSetPropRequest(
				2, "factorio.settings", "max_players", 3,
			));
			await call(
				"handleInstanceConfigInheritFieldRequest",
				new lib.InstanceConfigInheritFieldRequest(2, "factorio.settings", "max_players"),
			);
			const config = mockController.instances.get(2).config;
			assert.equal(config.get("factorio.settings").max_players, 0);
			assert.equal(config.isInherited("factorio.settings", "max_players"), true);
		});

		it("creates a template from an existing instance", async function() {
			await create({ "instance.id": 3, "instance.name": "copy", "instance.is_template": true }, 2);
			const config = mockController.instances.get(3).config;
			assert.equal(config.get("instance.is_template"), true);
			assert.equal(config.get("instance.template_id"), 1);
			assert.equal(config.get("factorio.version"), "2.0");
		});

		it("inherits a field again", async function() {
			await call("handleInstanceConfigSetFieldRequest", setField(2, "factorio.version", "2.1"));
			await call(
				"handleInstanceConfigInheritFieldRequest",
				new lib.InstanceConfigInheritFieldRequest(2, "factorio.version"),
			);
			const config = mockController.instances.get(2).config;
			assert.equal(config.get("factorio.version"), "2.0");
			assert.equal(config.isInherited("factorio.version"), true);
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
});
