import assert from "node:assert/strict";
import events from "node:events";
import { Controller, WsServer } from "@clusterio/controller";
import { ControllerConfig } from "@clusterio/lib";

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
});
