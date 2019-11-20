const assert = require('assert').strict;
const events = require('events');

const link = require("lib/link");
const errors = require("lib/errors");
const schema = require("lib/schema");


class MockSocket {
	constructor() {
		this.sentMessages = [];
		this.events = new Map();
		this.handshake = { address: "socket.test" };
	}

	send(message) {
		this.sentMessages.push(message);
	}

	on(event, fn) {
		this.events.set(event, fn);
	}

	disconnect() {
		this.disconnectCalled = true;
	}

	close() {
		this.closeCalled = true;
	}
};

describe("lib/link/link", function() {
	describe("class Link", function() {
		let testLink = new link.Link('source', 'target', new MockSocket);
		testLink.setValidator('simple', schema.compile({
			properties: {
				"data": {
					type: 'object',
					properties: {
						"string": { type: 'string' },
					},
				},
			},
		}));

		describe(".setValidator()", function() {
			it("should set the validator", function() {
				testLink.setValidator('test', () => true);
				assert(testLink._validators.has('test'), "validator was not added");
			});
			it("should throw on duplicated validator", function() {
				assert.throws(
					() => testLink.setValidator('test', () => true),
					new Error("test already has a validator")
				);
			});
		});

		describe(".setHandler()", function() {
			it("should throw if validator is not passed", function() {
				assert.throws(
					() => testLink.setHandler('no_validator_test', (message) => {}),
					new Error("validator is required")
				);
			});
			it("should set the handler", function() {
				let handler = (message) => {};
				testLink.setHandler('handler_test', handler, (message) => true);
				assert.equal(testLink._handlers.get('handler_test'), handler);
			});
			it("should throw on duplicated handler", function() {
				assert.throws(
					() => testLink.setHandler('handler_test', (message) => {}),
					new Error("handler_test already has a handler")
				);
			});
		});

		describe(".processMessage()", function() {
			it("should throw on invalid message", function() {
				assert.throws(
					() => testLink.processMessage({ data: "invalid message" }),
					new errors.InvalidMessage("Malformed message")
				);
			});
			it("should throw on message without validator", function() {
				assert.throws(
					() => testLink.processMessage({ seq: 1, type: 'no_validator', data: {} }),
					new errors.InvalidMessage("No validator for no_validator")
				);
			});
			it("should throw on message failing validation", function() {
				assert.throws(
					() => testLink.processMessage({ seq: 1, type: 'simple', data: { string: 1 }}),
					new errors.InvalidMessage("Validation failed for simple")
				);
			});
			it("should throw on unhandled message", function() {
				assert.throws(
					() => testLink.processMessage({ seq: 1, type: 'simple', data: { string: "a" }}),
					new errors.InvalidMessage("Unhandled message simple")
				);
			});
		});

		describe("._processHandler()", function() {
			it("should call the handler", function() {
				let handled = [];
				testLink.setHandler('handled', (message) => handled.push(message), (message) => true)
				testLink._processHandler({ seq: 1, type: 'handled', data: { test: "foo" } });
				assert.deepEqual(handled, [{ seq: 1, type: 'handled', data: { test: "foo" } }]);
			});
			it("should return true if handled", function() {
				let result = testLink._processHandler({ seq: 1, type: 'handled', data: {} });
				assert.equal(result, true);
			});
			it("should return false if not handled", function() {
				let result = testLink._processHandler({ seq: 1, type: 'not_handled', data: {} });
				assert.equal(result, false);
			});
		});

		describe(".disconnect()", function() {
			it("is abstract", function() {
				assert.throws(
					() => testLink.disconnect(),
					new Error("Abstract function")
				);
			});
		});

		describe(".send()", function() {
			it("calls send on the socket", function() {
				let seq = testLink.send('test', { test: true });
				assert.deepEqual(testLink.socket.sentMessages, [{ seq, type: 'test', data: { test: true }}]);
				testLink.socket.sentMessages = [];
			});
		});

		describe("._processWaiters()", function() {
			it("should call waiters", async function() {
				let waiter = new Promise(resolve => {
					testLink._waiters.set('test', [{ resolve, data: {} }]);
				});
				assert(
					testLink._processWaiters({ type: 'test', seq: 4, data: {} }),
					"Waiter was not processed"
				);
				assert.deepEqual(await waiter, { type: 'test', seq: 4, data: {} });
			});
			it("should filter on data", async function() {
				let waiter = new Promise(resolve => {
					testLink._waiters.set('test', [{ resolve, data: { a: 1, b: 2 } }]);
				});
				assert(
					!testLink._processWaiters({ type: 'test', seq: 4, data: {} }),
					"Incorrectly matched empty message"
				);
				assert(
					!testLink._processWaiters({ type: 'test', seq: 4, data: { a: 1, b: 0 } }),
					"Incorrectly matched message with wrong data"
				);
				assert(
					testLink._processWaiters({ type: 'test', seq: 4, data: { a: 1, b: 2, c: 3 } }),
					"Did not match correct message"
				);
				assert.deepEqual(await waiter, { type: 'test', seq: 4, data: { a: 1, b: 2, c: 3 } });
			});
		});

		describe(".waitFor()", function() {
			testLink.setValidator('waiter', (message) => true);
			it("should throw on missing validator", async function() {
				await assert.rejects(
					testLink.waitFor('no_validator', {}),
					new Error("no validator for no_validator")
				);
			});
			it("should wait for a given message", async function() {
				let result = testLink.waitFor('waiter', {});
				assert(
					testLink._processWaiters({ type: 'waiter', seq: 5, data: {} }),
					"Did not proccess waiter"
				);
				assert.deepEqual(await result, { type: 'waiter', seq: 5, data: {} });
			});
			it("should handle multiple waiters", async function() {
				let result1 = testLink.waitFor('waiter', {});
				let result2 = testLink.waitFor('waiter', {});
				assert(
					testLink._processWaiters({ type: 'waiter', seq: 5, data: {} }),
					"Did not proccess waiter"
				);
				assert.deepEqual(await result1, { type: 'waiter', seq: 5, data: {} });
				assert.deepEqual(await result2, { type: 'waiter', seq: 5, data: {} });
			});
		});

		describe(".close()", function() {
			it("should send close and call disconnect", function() {
				let called = false;
				testLink.disconnect = () => { called = true; }
				testLink.close("test reason");
				assert.deepEqual(
					testLink.socket.sentMessages,
					[{ seq: testLink._seq - 1, type: 'close', data: { reason: "test reason" } }]
				)
				assert(called, ".disconnect() was not called");
			});
		});
	});

	describe("class Connection", function() {
		let testConnection = new link.Connection('target', new MockSocket());
		it("should send ready after constructor", function() {
			assert.deepEqual(
				testConnection.socket.sentMessages,
				[{seq: 2, type: 'ready', data: {}}]
			);
			testConnection.socket.sentMessages = [];
		});
		it("should disconnect when receiving a close message", function() {
			testConnection.socket.disconnectCalled = false;
			testConnection.socket.events.get('message')({
				seq: 1, type: 'close', data: { reason: "test close" }
			});
			assert(testConnection.socket.disconnectCalled, "Disconnect was not called");
		});
		it("should close when receiving an invalid message", function() {
			testConnection.socket.events.get('message')({ invalid: true });
			assert.deepEqual(
				testConnection.socket.sentMessages,
				[{seq: testConnection._seq - 1, type: 'close', data: { reason: "Invalid message: Malformed message" }}]
			);
			testConnection.socket.sentMessages = [];
		});

		describe(".disconnect()", function() {
			it("should call disconnect on the socket", function() {
				testConnection.socket.disconnectCalled = false;
				testConnection.disconnect();
				assert(testConnection.socket.disconnectCalled, "Disconnect was not called");
			});
		});
	});

	describe("class Client", function() {
		let testClient = new link.Client('source', 'url', 'token');
		testClient.socket = new MockSocket();
		describe(".disconnect()", function() {
			it("should call close on the socket", function() {
				testClient.socket.closeCalled = false;
				testClient.disconnect();
				assert(testClient.socket.closeCalled, "Close was not called");
			});
		});

		describe(".register()", function() {
			it("is abstract", function() {
				assert.throws(
					() => testClient.register(),
					new Error("Abstract function")
				);
			});
		});

		describe(".processHandshake()", function() {
			it("should close on invalid message", function() {
				testClient._processHandshake({ data: "invalid message" }),
				assert.deepEqual(
					testClient.socket.sentMessages,
					[{seq: testClient._seq - 1, type: 'close', data: {
						reason: "Invalid handshake" }
					}]
				);
				testClient.socket.sentMessages = [];
			});
			it("should call register on hello", function() {
				let called = false;
				testClient.register = () => { called = true; };
				testClient._processHandshake({ seq: 1, type: 'hello', data: { version: "test" }}),
				assert(called, "register was not called");
			});
			it("should emit ready on ready", async function() {
				let result = events.once(testClient._events, 'ready');
				testClient._processHandshake({ seq: 1, type: 'ready', data: {}}),
				await result;
			});
			it("should emit error on close", async function() {
				let result = events.once(testClient._events, 'ready');
				testClient._processHandshake({ seq: 1, type: 'close', data: { reason: "test" }}),
				await assert.rejects(result, new Error("server closed during handshake: test"));
			});
		});

		describe("._attachSocketHandlers()", function() {
			it("should attach handlers", function() {
				testClient._attachSocketHandlers();
				assert(testClient.socket.events.size > 0, "No handlers were attached");
			});
			it("should throw on message received in invalid state", function() {
				testClient._state = "new";
				assert.throws(
					() => testClient.socket.events.get('message')(),
					new Error("Received message in unexpected state new")
				);
			});
			it("should call _processHandshake on message in handshake state", function() {
				testClient._state = "handshake";
				let called = false;
				testClient._processHandshake = () => { called = true; };
				testClient.socket.events.get('message')();
				assert(called, "_processHandshake was not called");
			});
			it("should call processMessage on message in ready state", function() {
				testClient._state = "ready";
				let called = false;
				testClient.processMessage = () => { called = true; };
				testClient.socket.events.get('message')();
				assert(called, "processMessage was not called");
				delete testClient.processMessage;
			});
			it("should close on invalid message in ready state", function() {
				testClient._state = "ready";
				testClient.socket.events.get('message')({ data: "invalid message"});
				assert.deepEqual(
					testClient.socket.sentMessages,
					[{seq: testClient._seq - 1, type: 'close', data: {
						reason: "Invalid message: Malformed message" }
					}]
				);
				testClient.socket.sentMessages = [];
			});
		});
	});
});
