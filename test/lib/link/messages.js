const assert = require('assert').strict;

const link = require('lib/link');
const errors = require('lib/errors');
const mock = require('../../mock');


describe("lib/link/messages", function() {
	let testSourceLink = new link.Link('source', 'target', new mock.MockConnector());
	let testTargetLink = new link.Link('target', 'source', new mock.MockConnector());

	let lastTargetSent;
	testTargetLink.send = (type, data) => { lastTargetSent = { type, data }; };

	describe("class Request", function() {
		let testRequest = new link.Request({
			type: 'test',
			links: ['source-target'],
		});

		describe("constructor", function() {
			it("should throw on invalid forwardTo", function() {
				assert.throws(
					() => new link.Request({ forwardTo: 'invalid'}),
					new Error("Invalid forwardTo value invalid")
				);
			});
		});

		describe(".attach()", function() {
			it("should attach validator to a source link", function() {
				testRequest.attach(testSourceLink);
				assert(testSourceLink._validators.has('test_response'), "Validator was not set");
			});
			it("should throw if missing handler on target link", function() {
				assert.throws(
					() => testRequest.attach(testTargetLink),
					new Error("Missing handler for test_request on target-source link")
				);
			});

			let handlerResult;
			it("should attach handler to a target link", function() {
				testRequest.attach(testTargetLink, async (message) => handlerResult );
				assert(testTargetLink._handlers.has('test_request'), "Handler was not set");
			});
			it("should send result of calling the handler", async function() {
				handlerResult = { test: "handler" };
				testTargetLink._handlers.get('test_request')({ seq: 2 });
				let result = await new Promise(resolve => {
					testTargetLink.connector.send = (type, data) => resolve({ type, data });
				});
				assert.deepEqual(result, {
					type: 'test_response',
					data: {
						test: "handler",
						seq: 2,
					},
				});
			});
			it("should implicitly send an empty object on empty return", async function() {
				handlerResult = undefined;
				testTargetLink._handlers.get('test_request')({ seq: 2 });
				let result = await new Promise(resolve => {
					testTargetLink.connector.send = (type, data) => resolve({ type, data });
				});
				assert.deepEqual(result, {
					type: 'test_response',
					data: {
						seq: 2,
					},
				});
			});
		});

		describe(".send()", function() {
			it("should send request with send and use waitFor to get response", async function() {
				let request;
				testSourceLink.connector.send = (type, data) => {
					request = { type, data };
				};
				testSourceLink.waitFor = (type, condition) => {
					return { data: { type, request }};
				};
				assert.deepEqual(
					await testRequest.send(testSourceLink, { test: "request" }),
					{ type: 'test_response', request: { type: 'test_request', data: {test: "request" }}}
				);
				delete testSourceLink.connector.send;
				delete testSourceLink.waitFor;
			});
			it("should throw error response", async function() {
				testSourceLink.waitFor = (type, condition) => {
					return { data: { error: "test error" }};
				};
				assert.rejects(
					testRequest.send(testSourceLink),
					new errors.RequestError("test error")
				);
				delete testSourceLink.waitFor;
			});
		});
	});

	describe("class Event", function() {
		let testEvent = new link.Event({
			type: 'test',
			links: ['source-target'],
		});

		describe("constructor", function() {
			it("should throw on invalid forwardTo", function() {
				assert.throws(
					() => new link.Event({ forwardTo: 'invalid'}),
					new Error("Invalid forwardTo value invalid")
				);
			});
			it("should throw on invalid broadcastTo", function() {
				assert.throws(
					() => new link.Event({ broadcastTo: 'invalid'}),
					new Error("Invalid broadcastTo value invalid")
				);
			});
		});

		describe(".attach()", function() {
			it("should throw if missing handler on target link", function() {
				assert.throws(
					() => testEvent.attach(testTargetLink),
					new Error("Missing handler for test_event on target-source link")
				);
			});
			let called = false;
			it("should attach handler and validator to a target link", function() {
				testEvent.attach(testTargetLink, async (message) => { called = true; });
				assert(testTargetLink._validators.has('test_event'), "Validator was not set");
			});
			it("should call the attached event handler", function() {
				testTargetLink._handlers.get("test_event")();
				assert(called, "Handler was not called");
			});
		});

		describe(".send()", function() {
			it("should send the event over the link", async function() {
				testSourceLink.connector.sentMessages = [];
				testEvent.send(testSourceLink, { test: "event" });
				let seq = testSourceLink.connector._seq - 1;
				assert.deepEqual(
					testSourceLink.connector.sentMessages,
					[{ seq, type: "test_event", data: { test: "event" }}]
				);
			});
		});
	});

	describe("attachAllMessages()", function() {
		it("does not throw", function() {
			link.attachAllMessages(testSourceLink);
		})
	});
});
