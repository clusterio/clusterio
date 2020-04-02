const assert = require('assert').strict;
const events = require('events');

const mock = require('../../mock');
const link = require('lib/link');


describe("lib/link/connectors", function() {
	describe("class WebSocketBaseConnector", function() {
		let testConnector = new link.WebSocketBaseConnector();

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
		let testConnector = new link.WebSocketClientConnector('url', 1);
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
				testConnector._state = "handshake";
				testConnector._socket.sentMessages = [];
				testConnector.sendHandshake('test', { test: true });
				assert.deepEqual(
					testConnector._socket.sentMessages.map(JSON.parse),
					[{ seq: null, type: 'test', data: { test: true }}]
				);
			});
		});

		describe(".send()", function() {
			it("calls send on the socket", function() {
				testConnector._state = "connected";
				testConnector._socket.sentMessages = [];
				let seq = testConnector.send('test', { test: true });
				assert.deepEqual(
					testConnector._socket.sentMessages.map(JSON.parse),
					[{ seq, type: 'test', data: { test: true }}]
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

		describe(".processHandshake()", function() {
			it("should close on invalid message", function() {
				testConnector._socket.closeCalled = false;
				testConnector._processHandshake({ data: "invalid message" }),
				assert(testConnector._socket.closeCalled, "Close was not called on the socket");
			});
			it("should call register on hello", function() {
				let called = false;
				testConnector.register = () => { called = true; };
				testConnector._processHandshake({ seq: 1, type: 'hello', data: { version: "test" }});
				assert(called, "register was not called");
			});
			it("should emit connected on ready", async function() {
				let result = events.once(testConnector, 'connected');
				testConnector._processHandshake(
					{ seq: 1, type: 'ready', data: { session_token: "x", heartbeat_interval: 10 }}
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
				testConnector._state = "new";
				assert.throws(
					() => testConnector._socket.events.get("message")("{}"),
					new Error("Received message in unexpected state new")
				);
			});
			it("should call _processHandshake on message in handshake state", function() {
				testConnector._state = "handshake";
				let called = false;
				testConnector._processHandshake = () => { called = true; };
				testConnector._socket.events.get("message")("{}");
				assert(called, "_processHandshake was not called");
			});
			it("should emit message on message in connected state", async function() {
				testConnector._socket.sentMessages = [];
				testConnector._state = "connected";
				let result = events.once(testConnector, 'message');
				testConnector._socket.events.get("message")('{"message":true}');
				assert.deepEqual(await result, [{ message: true }]);
			});
		});
	});
});
