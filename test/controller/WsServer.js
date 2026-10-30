import assert from "node:assert/strict";
import events from "node:events";
import jwt from "jsonwebtoken";
import * as lib from "@clusterio/lib";
import { Controller, HostRecord, WsServer } from "@clusterio/controller";
import { ControllerConfig } from "@clusterio/lib";
import packageJson from "@clusterio/controller/package.json" with { type: "json" };

import "../setup_logging.js";

class MockWebSocket extends events.EventEmitter {
	constructor() {
		super();
		this.sent = [];
		this.closed = null;
	}

	send(message) {
		this.sent.push(JSON.parse(message));
	}

	close(code, reason) {
		this.closed = { code, reason };
	}

	terminate() {
		this.emit("close", 1006, "");
	}
}

describe("controller/src/WsServer", function() {
	describe("class WsServer", function() {
		/** @type {WsServer} */
		let wsServer;
		before(function() {
			let config = new ControllerConfig("controller");
			config.set("controller.trusted_proxies", "127.0.0.0/8, ::1");
			let controller = new Controller({}, [], config);
			wsServer = controller.wsServer;
		});
		describe(".remoteAddr()", function() {
			it("should resolve X-Forward-For header for trusted proxies", function() {
				const ipv4 = wsServer.remoteAddr({
					socket: {
						remoteAddress: "127.0.0.1",
						remoteFamily: "IPv4",
					},
					headers: { "x-forwarded-for": "1.2.3.4" },
				});
				assert.equal(ipv4, "1.2.3.4");
				const ipv6 = wsServer.remoteAddr({
					socket: {
						remoteAddress: "::1",
						remoteFamily: "IPv6",
					},
					headers: { "x-forwarded-for": "2000::1" },
				});
				assert.equal(ipv6, "2000::1");
			});
			it("should pick the last address in X-Forward-For header for trusted proxies", function() {
				const ipv4 = wsServer.remoteAddr({
					socket: {
						remoteAddress: "127.0.0.1",
						remoteFamily: "IPv4",
					},
					headers: { "x-forwarded-for": "1.0.0.0, 2.0.0.0, 1.2.3.4" },
				});
				assert.equal(ipv4, "1.2.3.4");
				const ipv6 = wsServer.remoteAddr({
					socket: {
						remoteAddress: "::1",
						remoteFamily: "IPv6",
					},
					headers: { "x-forwarded-for": "2001::, 2002::, 2000::1" },
				});
				assert.equal(ipv6, "2000::1");
			});
			it("should not resolve X-Forward-For header for untrusted proxies", function() {
				const ipv4 = wsServer.remoteAddr({
					socket: {
						remoteAddress: "1.2.3.4",
						remoteFamily: "IPv4",
					},
					headers: { "x-forwarded-for": "127.0.0.1" },
				});
				assert.equal(ipv4, "1.2.3.4");
				const ipv6 = wsServer.remoteAddr({
					socket: {
						remoteAddress: "2000::1",
						remoteFamily: "IPv6",
					},
					headers: { "x-forwarded-for": "::1" },
				});
				assert.equal(ipv6, "2000::1");
			});
		});
		describe(".handleConnection()", function() {
			it("should handle socket errors before the handshake completes", function() {
				// A ws socket emits "error" for e.g. a close frame with the reserved code 1006
				const socket = new events.EventEmitter();
				socket.send = () => {};
				socket.close = () => {};
				socket.terminate = () => {};
				const req = { socket: { remoteAddress: "1.2.3.4", remoteFamily: "IPv4" }, headers: {} };
				wsServer.handleConnection(socket, req);
				try {
					assert.doesNotThrow(() => {
						socket.emit("error", new RangeError("Invalid WebSocket frame: invalid status code 1006"));
					});
				} finally {
					socket.emit("message", "not json"); // ends the handshake and its timeout
				}
			});
		});
	});
	describe(".registerHost()", function() {
		const secret = Buffer.from("TestSecretDoNotUse");
		const req = { socket: { remoteAddress: "10.0.0.1", remoteFamily: "IPv4" }, headers: {} };
		/** @type {Controller} */
		let controller;
		/** @type {WsServer} */
		let wsServer;
		let socket;
		beforeEach(function() {
			const config = new ControllerConfig("controller");
			config.set("controller.auth_secret", secret.toString("base64"));
			controller = new Controller(lib.logger, [], config);
			wsServer = controller.wsServer;
			socket = new MockWebSocket();
		});
		afterEach(function() {
			for (const connection of wsServer.hostConnections.values()) {
				connection.connector.terminate();
			}
		});

		function addHost(id, tokenValidAfter = 0) {
			const record = new HostRecord(id, `host-${id}`, "", new Map(), false, "", "203.0.113.1", tokenValidAfter);
			controller.hosts.set(record);
			return record;
		}

		async function register(token, id = 5) {
			await wsServer.registerHost(new lib.RegisterHostData(token, packageJson.version, id, {}), socket, req);
		}

		function assertRejected(reason) {
			assert.deepEqual(socket.closed, { code: lib.ConnectionClosed.Unauthorized, reason });
			assert.equal(socket.closed.code, 3000);
			assert.equal(wsServer.hostConnections.size, 0);
			assert(!socket.sent.some(message => message.type === "ready"), "ready was sent");
		}

		it("should reject a validly signed token for a host that is not registered", async function() {
			await register(controller.generateHostToken(5));
			assertRejected(
				"Authentication failed: host is not registered, run the installer again in the host directory"
			);
			assert.equal(controller.hosts.has(5), false, "host record was created");
		});
		it("should accept a registered host", async function() {
			const record = addHost(5);
			await register(controller.generateHostToken(5));
			assert.equal(socket.closed, null);
			assert(socket.sent.some(message => message.type === "ready"), "ready was not sent");
			assert(wsServer.hostConnections.has(5));

			assert.equal(controller.hosts.size, 1);
			assert.equal(controller.hosts.get(5), record, "host record was replaced");
			assert.equal(record.connected, true);
			assert.equal(record.version, packageJson.version);
			assert.equal(record.remoteAddress, "10.0.0.1");
			assert.equal(record.name, "host-5");
			assert.equal(record.publicAddress, "203.0.113.1");

			wsServer.hostConnections.get(5).connector.terminate();
			assert.equal(wsServer.hostConnections.has(5), false);
			assert.equal(controller.hosts.get(5).connected, false);
		});
		it("should reject a token issued before tokenValidAfter", async function() {
			const token = controller.generateHostToken(5);
			addHost(5, Math.floor(Date.now() / 1000) + 60);
			await register(token);
			assertRejected("Authentication failed: invalid token");
		});
		it("should accept a token issued at tokenValidAfter", async function() {
			const now = Math.floor(Date.now() / 1000);
			addHost(5, now);
			await register(jwt.sign({ aud: "host", host: 5, iat: now }, secret));
			assert.equal(socket.closed, null);
			assert(wsServer.hostConnections.has(5));
		});
		it("should reject a token without an issue time", async function() {
			addHost(5);
			await register(jwt.sign({ aud: "host", host: 5 }, secret, { noTimestamp: true }));
			assertRejected("Authentication failed: invalid token");
		});
		it("should reject a token for another host", async function() {
			addHost(5);
			addHost(6);
			await register(controller.generateHostToken(6), 5);
			assertRejected("Authentication failed: missmatched host id");
		});
		it("should reject a token signed with another secret", async function() {
			addHost(5);
			await register(jwt.sign({ aud: "host", host: 5 }, Buffer.from("OtherSecret")));
			assertRejected("Authentication failed: invalid signature");
		});
		it("should reject a host revoked while its previous connection closes", async function() {
			const record = addHost(5);
			wsServer.hostConnections.set(5, {
				remoteAddress: "10.0.0.1",
				async disconnect() {
					controller.hosts.delete(record);
					wsServer.hostConnections.delete(5);
				},
			});
			await register(controller.generateHostToken(5));
			assertRejected("Authentication failed: host was revoked");
			assert.equal(controller.hosts.has(5), false, "host record was recreated");
		});
		it("should reject hosts in recovery mode", async function() {
			addHost(5);
			controller.recoveryMode = true;
			await register(controller.generateHostToken(5));
			assert.deepEqual(socket.closed, {
				code: lib.ConnectionClosed.RecoveryMode,
				reason: "Connection Refused: Controller in recovery mode",
			});
		});
	});
});
