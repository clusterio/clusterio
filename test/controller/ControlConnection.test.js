import assert from "node:assert/strict";
import events from "node:events";
import * as lib from "@clusterio/lib";
import { ControlConnection, ControllerHooks } from "@clusterio/controller";
import { MockConnector, MockLogger } from "../mock.js";

const addr = lib.Address.fromShorthand;

describe("controller/src/ControlConnection", function() {
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

		it("removes the debug dump listener after repeated requests", async function() {
			await connection.handleDebugDumpWsRequest(new lib.DebugDumpWsRequest());
			await connection.handleDebugDumpWsRequest(new lib.DebugDumpWsRequest());
			assert.equal(mockController.debugEvents.listenerCount("message"), 1);
			assert.equal(connector._socket.clusterio_ignore_dump, true);
			connector.emit("close");
			assert.equal(mockController.debugEvents.listenerCount("message"), 0);
		});
	});
});
