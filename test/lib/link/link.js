const assert = require('assert').strict;
const events = require('events');

const link = require("lib/link");
const errors = require("lib/errors");
const schema = require("lib/schema");
const mock = require("../../mock");


describe("lib/link/link", function() {
	describe("class Link", function() {
		let testLink = new link.Link('source', 'target', new mock.MockConnector());
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
	});
});
