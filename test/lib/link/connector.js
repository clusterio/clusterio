"use strict";
const assert = require("assert").strict;
const events = require("events");

const mock = require("../../mock");
const lib = require("@clusterio/lib");


describe("lib/link/connectors", function() {
	describe("class WebSocketBaseConnector", function() {
		let testConnector = new lib.WebSocketBaseConnector();

		describe("._dropSendBufferSeq()", function() {
			beforeEach(function() {
				testConnector._sendBuffer = [
					{ seq: 1, type: "test", data: {} },
					{ seq: 2, type: "test", data: {} },
					{ seq: 4, type: "test", data: {} },
				];
			});
			it("should do nothing if passed null", function() {
				testConnector._dropSendBufferSeq(null);
				assert(testConnector._sendBuffer.length === 3, "entries were dropped");
			});
			it("should drop up to sequence", function() {
				testConnector._dropSendBufferSeq(2);
				assert.equal(testConnector._sendBuffer.length, 1, "incorrect number of entries dropped");
			});
			it("should ignore holes", function() {
				testConnector._dropSendBufferSeq(3);
				assert.equal(testConnector._sendBuffer.length, 1, "incorrect number of entries dropped");
			});
		});
	});

	describe("class WebSocketClientConnector", function() {
		let testConnector = new lib.WebSocketClientConnector("url", 1);
		testConnector._socket = new mock.MockSocket();

		describe(".register()", function() {
			it("is abstract", function() {
				assert.throws(
					() => testConnector.register(),
					new Error("Abstract function")
				);
			});
		});

		describe(".sendHandshake()", function() {
			it("calls send on the socket", function() {
				testConnector._state = "connecting";
				testConnector._socket.sentMessages = [];
				testConnector.sendHandshake(new lib.MessageInvalidate());
				assert.deepEqual(
					testConnector._socket.sentMessages.map(JSON.parse),
					[{ type: "invalidate" }]
				);
			});
		});

		describe(".send()", function() {
			it("calls send on the socket", function() {
				testConnector._state = "connected";
				testConnector._socket.sentMessages = [];
				testConnector.send(new lib.MessageHeartbeat(1));
				assert.deepEqual(
					testConnector._socket.sentMessages.map(JSON.parse),
					[{ seq: 1, type: "heartbeat"}]
				);
			});
		});

		describe(".close()", function() {
			it("should call close", function() {
				testConnector._socket.closeCalled = false;
				testConnector.close("test reason");
				assert(testConnector._socket.closeCalled, "Close was not called on the socket");
			});
		});

		describe(".parseMessage()", function() {
			it("should close on invalid json", function() {
				testConnector._socket.closeCalled = false;
				testConnector._parseMessage("invalid json");
				assert(testConnector._socket.closeCalled, "Close was not called on the socket");
			});
			it("should close on invalid message", function() {
				testConnector._socket.closeCalled = false;
				testConnector._parseMessage('{"invalid":"message"}');
				assert(testConnector._socket.closeCalled, "Close was not called on the socket");
			});
		});
		describe(".processHandshake()", function() {
			it("should call register on hello", function() {
				let called = false;
				testConnector.register = () => { called = true; };
				testConnector._processHandshake(
					new lib.MessageHello(
						new lib.HelloData("test", {})
					)
				);
				assert(called, "register was not called");
			});
			it("should emit connect on ready", async function() {
				let result = events.once(testConnector, "connect");
				testConnector._processHandshake(
					new lib.MessageReady(
						new lib.ReadyData(
							new lib.Address(lib.Address.control, 1),
							"x",
							20,
							10,
							undefined
						)
					)
				);
				await result;
				clearInterval(testConnector._heartbeatId);
			});
		});

		describe("._attachSocketHandlers()", function() {
			it("should attach handlers", function() {
				testConnector._attachSocketHandlers();
				assert(testConnector._socket.events.size > 0, "No handlers were attached");
			});
			it("should throw on message received in invalid state", function() {
				testConnector._state = "closed";
				assert.throws(
					() => testConnector._socket.events.get("message")(JSON.stringify(new lib.MessageInvalidate())),
					new Error("Received message in unexpected state closed")
				);
			});
			it("should call _processHandshake on message in handshake state", function() {
				testConnector._state = "connecting";
				let called = false;
				testConnector._processHandshake = () => { called = true; };
				testConnector._socket.events.get("message")(JSON.stringify(new lib.MessageInvalidate()));
				assert(called, "_processHandshake was not called");
			});
			it("should emit message on message in connected state", async function() {
				testConnector._socket.sentMessages = [];
				testConnector._state = "connected";
				let result = events.once(testConnector, "message");
				let addr = new lib.Address(lib.Address.control, 1);
				let event = new lib.MessageEvent(1, addr, addr, "TestEvent");
				testConnector._socket.events.get("message")(JSON.stringify(event));
				assert.deepEqual((await result)[0], event);
			});
		});
	});
});
