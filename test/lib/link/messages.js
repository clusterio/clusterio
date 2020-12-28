"use strict";
const assert = require("assert").strict;

const libLink = require("@clusterio/lib/link");
const libErrors = require("@clusterio/lib/errors");
const mock = require("../../mock");


describe("lib/link/messages", function() {
	let testSourceLink = new libLink.Link("source", "target", new mock.MockConnector());
	let testTargetLink = new libLink.Link("target", "source", new mock.MockConnector());

	let lastTargetSent;
	testTargetLink.send = (type, data) => { lastTargetSent = { type, data }; };

	describe("class Request", function() {
		let testRequest = new libLink.Request({
			type: "test",
			links: ["source-target"],
			requestProperties: {
				"test": { type: "string" },
			},
			responseProperties: {
				"test": { type: "string" },
			},
		});

		describe("constructor", function() {
			it("should throw on invalid forwardTo", function() {
				assert.throws(
					() => new libLink.Request({ links: [], forwardTo: "invalid" }),
					new Error("Invalid forwardTo value invalid")
				);
			});
		});

		describe(".attach()", function() {
			it("should attach validator to a source link", function() {
				testRequest.attach(testSourceLink);
				assert(testSourceLink._validators.has("test_response"), "Validator was not set");
			});
			it("should throw if missing handler on target link", function() {
				assert.throws(
					() => testRequest.attach(testTargetLink),
					new Error("Missing handler for test_request on target-source link")
				);
			});

			let handlerResult;
			it("should attach handler to a target link", function() {
				testRequest.attach(testTargetLink, async (message) => handlerResult);
				assert(testTargetLink._handlers.has("test_request"), "Handler was not set");
			});
			it("should send result of calling the handler", async function() {
				handlerResult = { test: "handler" };
				testTargetLink._handlers.get("test_request")({ seq: 2 });
				let result = await new Promise(resolve => {
					testTargetLink.connector.send = (type, data) => resolve({ type, data });
				});
				assert.deepEqual(result, {
					type: "test_response",
					data: {
						test: "handler",
						seq: 2,
					},
				});
			});
			it("should implicitly send an empty object on empty return", async function() {
				let emptyRequest = new libLink.Request({
					type: "empty",
					links: ["source-target"],
				});
				emptyRequest.attach(testTargetLink, async(message) => {});
				testTargetLink._handlers.get("empty_request")({ seq: 2 });
				let result = await new Promise(resolve => {
					testTargetLink.connector.send = (type, data) => resolve({ type, data });
				});
				assert.deepEqual(result, {
					type: "empty_response",
					data: {
						seq: 2,
					},
				});
			});
			it("should validate response from handler", async function() {
				handlerResult = { test: 12 };
				testTargetLink._handlers.get("test_request")({ seq: 2 });
				let result = await new Promise(resolve => {
					testTargetLink.connector.send = (type, data) => resolve({ type, data });
				});
				assert.deepEqual(result, {
					type: "test_response",
					data: {
						error: "Validation failed responding to test_request",
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
				testSourceLink.waitFor = (type, condition) => ({ data: { type, request }});
				assert.deepEqual(
					await testRequest.send(testSourceLink, { test: "request" }),
					{ type: "test_response", request: { type: "test_request", data: { test: "request" }}}
				);
				delete testSourceLink.connector.send;
				delete testSourceLink.waitFor;
			});
			it("should throw error response", async function() {
				testSourceLink.waitFor = (type, condition) => ({ data: { error: "test error" }});
				await assert.rejects(
					testRequest.send(testSourceLink, { test: "blah" }),
					new libErrors.RequestError("test error")
				);
				delete testSourceLink.waitFor;
			});
		});
	});

	describe("class Event", function() {
		let testEvent = new libLink.Event({
			type: "test",
			links: ["source-target"],
			eventProperties: {
				"test": { type: "string" },
			},
		});

		describe("constructor", function() {
			it("should throw on invalid forwardTo", function() {
				assert.throws(
					() => new libLink.Event({ forwardTo: "invalid" }),
					new Error("Invalid forwardTo value invalid")
				);
			});
			it("should throw on invalid broadcastTo", function() {
				assert.throws(
					() => new libLink.Event({ broadcastTo: "invalid" }),
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
				assert(testTargetLink._validators.has("test_event"), "Validator was not set");
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
			libLink.attachAllMessages(testSourceLink);
		});
	});
});
