"use strict";
const assert = require("assert").strict;
const events = require("events");

const lib = require("@clusterio/lib");
const mock = require("../../mock");

const addr = lib.Address.fromShorthand;

describe("lib/link/link", function() {
	function throwSimple(message) {
		let err = new Error(message);
		err.stack = message;
		throw err;
	}

	describe("class Link", function() {
		let testConnector;
		/** @type {lib.Link} */
		let testLink;
		let src = addr({ controlId: 1 });
		let dst = addr("controller");

		class SimpleRequest {
			static type = "request";
			static src = ["controller", "control"];
			static dst = ["controller", "control"];
			static permission = null;
		}
		lib.Link.register(SimpleRequest);
		class NumberRequest {
			static type = "request";
			static src = ["controller", "control"];
			static dst = ["controller", "control"];
			static permission = null;
			constructor(value) { this.value = value; }
			static jsonSchema = { type: "number" };
			toJSON() { return this.value; }
			static fromJSON(json) { return new this(json); }
		}
		NumberRequest.Response = class {
			constructor(value) { this.value = value; }
			static jsonSchema = { type: "number" };
			toJSON() { return this.value; }
			static fromJSON(json) { return new this(json); }
		};
		lib.Link.register(NumberRequest);
		class SimpleEvent {
			static type = "event";
			static src = ["controller", "control"];
			static dst = ["controller", "control"];
			static permission = null;
		}
		lib.Link.register(SimpleEvent);
		class NumberEvent {
			static type = "event";
			static src = ["controller", "control"];
			static dst = ["controller", "control"];
			static permission = null;
			constructor(value) { this.value = value; }
			static jsonSchema = { type: "number" };
			toJSON() { return this.value; }
			static fromJSON(json) { return new this(json); }
		}
		lib.Link.register(NumberEvent);

		beforeEach(function() {
			testConnector = new mock.MockConnector(src, dst);
			testLink = new lib.Link(testConnector);
		});

		it("should handle unknown message", async function() {
			testConnector.emit("message", { type: "unknown" });
		});

		describe("Request handling", function() {
			it("should give an error response back on unrecognized request", function() {
				testConnector.emit("message", new lib.MessageRequest(1, dst, src, "UnhandledRequest"));
				assert.deepEqual(testConnector.sentMessages, [
					new lib.MessageResponseError(
						testConnector._seq - 1,
						src,
						dst,
						new lib.ResponseError("Unrecognized request UnhandledRequest", "InvalidMessage")
					),
				]);
			});
			it("should give an error response back on unhandled request", function() {
				class UnhandledRequest {
					static type = "request";
					static src = "controller";
					static dst = "control";
				}
				lib.Link.register(UnhandledRequest);
				testConnector.emit("message", new lib.MessageRequest(1, dst, src, "UnhandledRequest"));
				assert.deepEqual(testConnector.sentMessages, [
					new lib.MessageResponseError(
						testConnector._seq - 1,
						src,
						dst,
						new lib.ResponseError("No handler for UnhandledRequest")
					),
				]);
			});
			it("should give an error response back on invalid src", function() {
				class InvalidSrcRequest {
					static type = "request";
					static src = "host";
					static dst = "control";
				}
				lib.Link.register(InvalidSrcRequest);
				testConnector.emit("message", new lib.MessageRequest(1, dst, src, "InvalidSrcRequest"));
				assert.deepEqual(testConnector.sentMessages, [
					new lib.MessageResponseError(
						testConnector._seq - 1,
						src,
						dst,
						new lib.ResponseError(
							"Source [Address controller:0] is not allowed for InvalidSrcRequest",
							"InvalidMessage"
						)
					),
				]);
			});
			it("should give an error response back on invalid dst", function() {
				class InvalidDstRequest {
					static type = "request";
					static src = "controller";
					static dst = "host";
				}
				lib.Link.register(InvalidDstRequest);
				testConnector.emit("message", new lib.MessageRequest(1, dst, src, "InvalidDstRequest"));
				assert.deepEqual(testConnector.sentMessages, [
					new lib.MessageResponseError(
						testConnector._seq - 1,
						src,
						dst,
						new lib.ResponseError(
							"Destination [Address control:1] is not allowed for InvalidDstRequest",
							"InvalidMessage",
						)
					),
				]);
			});
			it("should give an error response back on broadcast src", function() {
				testConnector.emit("message", new lib.MessageRequest(1, addr("allControls"), src, "SimpleRequest"));
				assert.deepEqual(testConnector.sentMessages, [
					new lib.MessageResponseError(
						testConnector._seq - 1,
						src,
						addr("allControls"),
						new lib.ResponseError("Message src may not be broadcast", "InvalidMessage")
					),
				]);
			});
			it("should give an error response back on requst with broadcast dst", function() {
				testConnector.emit("message", new lib.MessageRequest(1, dst, addr("allControls"), "SimpleRequest"));
				assert.deepEqual(testConnector.sentMessages, [
					new lib.MessageResponseError(
						testConnector._seq - 1,
						src,
						dst,
						new lib.ResponseError(
							"Destination [Address 4:control] is not allowed for SimpleRequest",
							"InvalidMessage",
						)
					),
				]);
			});
		});

		describe("Event handling", function() {
			it("should ignore unrecognized event", function() {
				testConnector.emit("message", new lib.MessageEvent(1, dst, src, "UnhandledEvent"));
				assert.deepEqual(testConnector.sentMessages, []);
			});
			it("should ignore unhandled event", function() {
				class UnhandledEvent {
					static type = "event";
					static src = "controller";
					static dst = "control";
				}
				lib.Link.register(UnhandledEvent);
				testConnector.emit("message", new lib.MessageEvent(1, dst, src, "UnhandledEvent"));
				assert.deepEqual(testConnector.sentMessages, []);
			});
			it("should ignore invalid src", function() {
				class InvalidSrcEvent {
					static type = "event";
					static src = "host";
					static dst = "control";
				}
				let handled = false;
				lib.Link.register(InvalidSrcEvent);
				testLink.snoopEvent(InvalidSrcEvent, async () => { handled = true; });
				testConnector.emit("message", new lib.MessageEvent(1, dst, src, "InvalidSrcEvent"));
				assert(!handled, "event was not ignored");
				assert.deepEqual(testConnector.sentMessages, []);
			});
			it("should ignore invalid dst", function() {
				class InvalidDstEvent {
					static type = "event";
					static src = "controller";
					static dst = "host";
				}
				lib.Link.register(InvalidDstEvent);
				let handled = false;
				testLink.snoopEvent(InvalidDstEvent, async () => { handled = true; });
				testConnector.emit("message", new lib.MessageEvent(1, dst, src, "InvalidDstEvent"));
				testConnector.emit("message", new lib.MessageEvent(1, dst, addr("allControls"), "InvalidDstEvent"));
				assert(!handled, "event was not ignored");
				assert.deepEqual(testConnector.sentMessages, []);
			});
			it("should ignore broadcast src", function() {
				let handled = false;
				testLink.snoopEvent(SimpleEvent, async () => { handled = true; });
				testConnector.emit("message", new lib.MessageEvent(1, addr("allControls"), src, "SimpleEvent"));
				assert(!handled, "event was not ignored");
				assert.deepEqual(testConnector.sentMessages, []);
			});
			it("should handle event with broadcast dst", function() {
				let handled = false;
				testLink.snoopEvent(SimpleEvent, async () => { handled = true; });
				testConnector.emit("message", new lib.MessageEvent(1, dst, addr("allControls"), "SimpleEvent"));
				assert(handled, "event was ignored");
				assert.deepEqual(testConnector.sentMessages, []);
			});
		});

		it("should send ready on connector prepareDisconnect", async function() {
			let message = events.once(testConnector, "send");
			message.catch(() => {});
			testConnector.emit("disconnectPrepare");
			assert.deepEqual(await message, [new lib.MessageDisconnect("ready")]);
		});
		it("should send ready on connector prepareDisconnect if an error occurs", async function() {
			testLink.prepareDisconnect = async () => { throwSimple("Error occured"); };
			let message = events.once(testConnector, "send");
			message.catch(() => {});
			testConnector.emit("disconnectPrepare");
			assert.deepEqual(await message, [new lib.MessageDisconnect("ready")]);
		});

		it("should reject pending requests on close", async function() {
			let pending = testLink.send(new SimpleRequest());
			pending.catch(() => {});
			testConnector.emit("close");
			await assert.rejects(pending, { message: "Session Closed" });
		});
		it("should reject pending requests on invalidate", async function() {
			let pending = testLink.send(new SimpleRequest());
			pending.catch(() => {});
			testConnector.emit("invalidate");
			await assert.rejects(pending, { message: "Session Lost" });
		});

		describe(".send()", function() {
			it("should send request to the other side of the link", async function() {
				let message = events.once(testConnector, "send");
				message.catch(() => {});
				testLink.send(new SimpleRequest());
				let srcReq = new lib.Address(lib.Address.control, 1, 1);
				assert.deepEqual(
					await message,
					[new lib.MessageRequest(1, srcReq, dst, "SimpleRequest", undefined)]
				);
			});
			it("should send request with data to the other side of the link", async function() {
				let message = events.once(testConnector, "send");
				message.catch(() => {});
				testLink.send(new NumberRequest(22));
				let srcReq = new lib.Address(lib.Address.control, 1, 1);
				assert.deepEqual(
					await message,
					[new lib.MessageRequest(1, srcReq, dst, "NumberRequest", new NumberRequest(22))]
				);
			});
			it("should send request and resolve when response is received", async function() {
				let message = events.once(testConnector, "send");
				message.catch(() => {});
				let request = testLink.send(new SimpleRequest());
				let srcReq = new lib.Address(lib.Address.control, 1, 1);
				testConnector.emit("message", new lib.MessageResponse(1, dst, srcReq));
				await request;
				assert.deepEqual(testLink._pendingRequests, new Map());
			});
			it("should send request and reject with error when error response is received", async function() {
				let message = events.once(testConnector, "send");
				message.catch(() => {});
				let request = testLink.send(new SimpleRequest());
				let srcReq = new lib.Address(lib.Address.control, 1, 1);
				testConnector.emit(
					"message",
					new lib.MessageResponseError(
						1, dst, srcReq, new lib.ResponseError("Error")
					)
				);
				await assert.rejects(
					request,
					{ message: "Error" }
				);
				assert.deepEqual(testLink._pendingRequests, new Map());
			});
			it("should send request and resolve with data when response is received", async function() {
				let message = events.once(testConnector, "send");
				message.catch(() => {});
				let request = testLink.send(new NumberRequest(22));
				let srcReq = new lib.Address(lib.Address.control, 1, 1);
				testConnector.emit("message", new lib.MessageResponse(1, dst, srcReq, 44));
				assert.deepEqual(await request, new NumberRequest.Response(44));
				assert.deepEqual(testLink._pendingRequests, new Map());
			});
			it("should send event to the other side of the link", async function() {
				let message = events.once(testConnector, "send");
				message.catch(() => {});
				testLink.send(new SimpleEvent());
				assert.deepEqual(
					await message,
					[new lib.MessageEvent(1, src, dst, "SimpleEvent", undefined)]
				);
			});
			it("should send event with data to the other side of the link", async function() {
				let message = events.once(testConnector, "send");
				message.catch(() => {});
				testLink.send(new NumberEvent(22));
				assert.deepEqual(
					await message,
					[new lib.MessageEvent(1, src, dst, "NumberEvent", new NumberEvent(22))]
				);
			});
		});
		describe(".handle()", function() {
			it("should register a request handler", function() {
				let handled = false;
				testLink.handle(SimpleRequest, async () => { handled = true; });
				assert(testLink._requestHandlers.has(SimpleRequest), "request handler was not registered");
				testConnector.emit("message", new lib.MessageRequest(1, dst, src, "SimpleRequest"));
				assert(handled, "request was not handled");
			});
			it("should send response error from request handler throwing", async function() {
				let message = events.once(testConnector, "send");
				message.catch(() => {});
				testLink.handle(SimpleRequest, async () => { throwSimple("Error"); });
				testConnector.emit("message", new lib.MessageRequest(1, dst, src, "SimpleRequest"));
				assert.deepEqual(
					await message,
					[new lib.MessageResponseError(
						1, src, dst, new lib.ResponseError("Error", undefined, "Error")
					)]
				);
			});
			it("should send response error on request validation failing", async function() {
				let message = events.once(testConnector, "send");
				message.catch(() => {});
				testLink.handle(NumberRequest, async () => 1);
				testConnector.emit("message", new lib.MessageRequest(1, dst, src, "NumberRequest", "not a number"));
				let response = (await message)[0];
				assert.deepEqual(
					response,
					new lib.MessageResponseError(
						1, src, dst,
						new lib.ResponseError(
							"Request NumberRequest failed validation",
							response.data.code,
							response.data.stack,
						)
					)
				);
			});
			it("should send response error on response validation failing", async function() {
				let message = events.once(testConnector, "send");
				message.catch(() => {});
				testLink.handle(NumberRequest, async () => "not a number");
				testConnector.emit("message", new lib.MessageRequest(1, dst, src, "NumberRequest", 1));
				let response = (await message)[0];
				assert.deepEqual(
					response,
					new lib.MessageResponseError(
						1, src, dst,
						new lib.ResponseError(
							"Response for request NumberRequest failed validation",
							response.data.code,
							response.data.stack,
						)
					)
				);
			});
			it("should send value returned from request handler", async function() {
				let message = events.once(testConnector, "send");
				message.catch(() => {});
				testLink.handle(NumberRequest, async (request) => request.value + 4);
				testConnector.emit("message", new lib.MessageRequest(1, dst, src, "NumberRequest", 1));
				let response = (await message)[0];
				assert.deepEqual(
					response,
					new lib.MessageResponse(1, src, dst, 5)
				);
			});
			it("should register an event handler", function() {
				let handled = false;
				testLink.handle(SimpleEvent, async () => { handled = true; });
				assert(testLink._eventHandlers.has(SimpleEvent), "event handler was not registered");
				testConnector.emit("message", new lib.MessageEvent(1, dst, src, "SimpleEvent"));
				assert(handled, "event was not handled");
			});
			it("should pass value to event handler", async function() {
				let value;
				testLink.handle(NumberEvent, async (event) => { value = event.value; });
				testConnector.emit("message", new lib.MessageEvent(1, dst, src, "NumberEvent", 9));
				assert.deepEqual(value, 9);
			});
			it("should log errors from event handler", function() {
				testLink.handle(SimpleEvent, async () => { throwSimple("Error"); });
				testConnector.emit("message", new lib.MessageEvent(1, dst, src, "SimpleEvent"));
			});
			it("should throw on unknown type", function() {
				assert.throws(
					() => testLink.handle({ name: "Bad", type: "bad" }),
					{ message: "Class Bad has unrecognized type bad" }
				);
			});
			it("should throw on double registration", function() {
				testLink.handle(SimpleRequest);
				assert.throws(
					() => testLink.handle(SimpleRequest),
					new Error("Request SimpleRequest is already registered")
				);
				testLink.handle(SimpleEvent);
				assert.throws(
					() => testLink.handle(SimpleEvent),
					new Error("Event SimpleEvent is already registered")
				);
			});
		});
		describe("static .register()", function() {
			it("should throw if Request has only one of jsonSchema and fromJSON", function() {
				class BadRequest1 {
					static type = "request";
					static src = "controller";
					static dst = "control";
					static jsonSchema = {};
				}
				assert.throws(
					() => lib.Link.register(BadRequest1),
					new Error("Request BadRequest1 has static jsonSchema but is missing static fromJSON")
				);
				class BadRequest2 {
					static type = "request";
					static src = "controller";
					static dst = "control";
					static fromJSON() {};
				}
				assert.throws(
					() => lib.Link.register(BadRequest2),
					new Error("Request BadRequest2 has static fromJSON but is missing static jsonSchema")
				);
			});
			it("should throw if Event has only one of jsonSchema and fromJSON", function() {
				class BadEvent1 {
					static type = "event";
					static src = "controller";
					static dst = "control";
					static jsonSchema = {};
				}
				assert.throws(
					() => lib.Link.register(BadEvent1),
					new Error("Event BadEvent1 has static jsonSchema but is missing static fromJSON")
				);
				class BadEvent2 {
					static type = "event";
					static src = "controller";
					static dst = "control";
					static fromJSON() {};
				}
				assert.throws(
					() => lib.Link.register(BadEvent2),
					new Error("Event BadEvent2 has static fromJSON but is missing static jsonSchema")
				);
			});
		});

		describe("._processMessage()", function() {
			it("should throw on unhandled type", function() {
				assert.throws(
					() => testLink._processMessage({ type: "invalid" }),
					{ message: "Unhandled message type invalid" }
				);
			});
			it("should throw on Event failing validation", function() {
				class StringEvent {
					static type = "event";
					static src = "controller";
					static dst = "control";
					constructor(value) { this.value = value; }
					static jsonSchema = { type: "string" };
					static fromJSON(json) { return new this(json); };
				}
				lib.Link.register(StringEvent);
				testLink.handle(StringEvent, () => {});
				assert.throws(
					() => testLink._processMessage(new lib.MessageEvent(1, dst, src, "StringEvent", 99)),
					{ message: "Event StringEvent failed validation" }
				);
			});
		});

		describe(".snoopEvent()", function() {
			it("should snoop an event", function() {
				let handled = false;
				testLink.snoopEvent(SimpleEvent, async () => { handled = true; });
				assert(testLink._eventSnoopers.has(SimpleEvent), "event was not snooped");
				testConnector.emit("message", new lib.MessageEvent(1, dst, src, "SimpleEvent"));
				assert(handled, "event was not handled");
			});
			it("should log errors from snoop handler", function() {
				testLink.snoopEvent(SimpleEvent, async () => { throwSimple("Error"); });
				testConnector.emit("message", new lib.MessageEvent(1, dst, src, "SimpleEvent"));
			});
			it("should throw on double registration", function() {
				testLink.snoopEvent(SimpleEvent);
				assert.throws(
					() => testLink.snoopEvent(SimpleEvent),
					new Error("Event SimpleEvent is already snooped")
				);
			});
		});
	});
});
