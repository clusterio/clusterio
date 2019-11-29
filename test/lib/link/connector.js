const assert = require('assert').strict;
const events = require('events');

const mock = require('../../mock');
const link = require('lib/link');


describe("lib/link/connectors", function() {
	describe("class SocketIOClientConnector", function() {
		let testConnector = new link.SocketIOClientConnector('source', 'url', 'token');
		testConnector._socket = new mock.MockSocket();
		describe(".disconnect()", function() {
			it("should call close on the socket", function() {
				testConnector._socket.closeCalled = false;
				testConnector.disconnect();
				assert(testConnector._socket.closeCalled, "Close was not called");
			});
		});

		describe(".register()", function() {
			it("is abstract", function() {
				assert.throws(
					() => testConnector.register(),
					new Error("Abstract function")
				);
			});
		});

		describe(".send()", function() {
			it("calls send on the socket", function() {
				testConnector._socket.sentMessages = [];
				let seq = testConnector.send('test', { test: true });
				assert.deepEqual(testConnector._socket.sentMessages, [{ seq, type: 'test', data: { test: true }}]);
			});
		});

		describe(".close()", function() {
			it("should send close and call disconnect", function() {
				testConnector._socket.sentMessages = [];
				let called = false;
				testConnector.disconnect = () => { called = true; }
				testConnector.close("test reason");
				assert.deepEqual(
					testConnector._socket.sentMessages,
					[{ seq: testConnector._seq - 1, type: 'close', data: { reason: "test reason" } }]
				)
				assert(called, ".disconnect() was not called");
			});
		});

		describe(".processHandshake()", function() {
			it("should close on invalid message", function() {
				testConnector._socket.sentMessages = [];
				testConnector._processHandshake({ data: "invalid message" }),
				assert.deepEqual(
					testConnector._socket.sentMessages,
					[{seq: testConnector._seq - 1, type: 'close', data: {
						reason: "Invalid handshake" }
					}]
				);
			});
			it("should call register on hello", function() {
				let called = false;
				testConnector.register = () => { called = true; };
				testConnector._processHandshake({ seq: 1, type: 'hello', data: { version: "test" }}),
				assert(called, "register was not called");
			});
			it("should emit ready on ready", async function() {
				let result = events.once(testConnector, 'ready');
				testConnector._processHandshake({ seq: 1, type: 'ready', data: {}}),
				await result;
			});
			it("should emit error on close", async function() {
				let result = events.once(testConnector, 'ready');
				testConnector._processHandshake({ seq: 1, type: 'close', data: { reason: "test" }}),
				await assert.rejects(result, new Error("server closed during handshake: test"));
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
					() => testConnector._socket.events.get('message')(),
					new Error("Received message in unexpected state new")
				);
			});
			it("should call _processHandshake on message in handshake state", function() {
				testConnector._state = "handshake";
				let called = false;
				testConnector._processHandshake = () => { called = true; };
				testConnector._socket.events.get('message')();
				assert(called, "_processHandshake was not called");
			});
			it("should emit message on message in ready state", async function() {
				testConnector._socket.sentMessages = [];
				testConnector._state = "ready";
				let result = events.once(testConnector, 'message');
				testConnector._socket.events.get('message')("message");
				assert.deepEqual(await result, ["message"]);
			});
		});
	});
});
