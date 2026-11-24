import t from "tap";
import * as lib from "@clusterio/lib";
import {
	TestWebSocketConnector, addr, linkPair, nextMessage, recordedLink, settle,
} from "../../shared/link.ts";

const control = addr({ controlId: 1 });
const controller = addr("controller");
const host = addr({ hostId: 1 });
const allControls = addr("allControls");

// Test messages, registered once here and never changed after.
class SimpleRequest {
	declare ["constructor"]: typeof SimpleRequest;
	static type = "request" as const;
	static src = ["controller", "control"] as const;
	static dst = ["controller", "control"] as const;
	static permission = null;
}
class NumberResponse {
	value: number;
	constructor(value: number) { this.value = value; }
	static jsonSchema = { type: "number" };
	toJSON() { return this.value; }
	static fromJSON(json: number) { return new this(json); }
}
class NumberRequest {
	declare ["constructor"]: typeof NumberRequest;
	static type = "request" as const;
	static src = ["controller", "control"] as const;
	static dst = ["controller", "control"] as const;
	static permission = null;
	value: number;
	constructor(value: number) { this.value = value; }
	static jsonSchema = { type: "number" };
	toJSON() { return this.value; }
	static fromJSON(json: number) { return new this(json); }
	static Response = NumberResponse;
}
class HostRequest {
	declare ["constructor"]: typeof HostRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "host" as const;
	static permission = null;
}
class SimpleEvent {
	declare ["constructor"]: typeof SimpleEvent;
	static type = "event" as const;
	static src = ["controller", "control"] as const;
	static dst = ["controller", "control"] as const;
	static permission = null;
}
class NumberEvent {
	declare ["constructor"]: typeof NumberEvent;
	static type = "event" as const;
	static src = ["controller", "control"] as const;
	static dst = ["controller", "control"] as const;
	static permission = null;
	value: number;
	constructor(value: number) { this.value = value; }
	static jsonSchema = { type: "number" };
	toJSON() { return this.value; }
	static fromJSON(json: number) { return new this(json); }
}
class HostEvent {
	declare ["constructor"]: typeof HostEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "host" as const;
}
class PluginRequest {
	declare ["constructor"]: typeof PluginRequest;
	static type = "request" as const;
	static src = ["controller", "control"] as const;
	static dst = ["controller", "control"] as const;
	static permission = null;
	static plugin = "link_test";
}
class PluginEvent {
	declare ["constructor"]: typeof PluginEvent;
	static type = "event" as const;
	static src = ["controller", "control"] as const;
	static dst = ["controller", "control"] as const;
	static permission = null;
	static plugin = "link_test";
}
class TestPluginError extends lib.ConflictError {
	static plugin = "link_test";
}
for (const Class of [SimpleRequest, NumberRequest, HostRequest, SimpleEvent, NumberEvent, HostEvent]) {
	lib.Link.register(Class as any);
}
lib.registerPluginMessages([
	{ name: "link_test", messages: [PluginRequest, PluginEvent], errors: [TestPluginError] } as any,
	{ name: "link_test_empty" } as any,
]);

// Link at a control, the other end is the controller.
function controlSide() {
	const setup = recordedLink(control, controller);
	const receive = (message: any) => { setup.connector.emit("message", message); };
	return { ...setup, receive };
}

// Link at the controller, the other end is a control. Permissions are checked here.
function controllerSide() {
	const setup = recordedLink(controller, control);
	const receive = (message: any) => { setup.connector.emit("message", message); };
	return { ...setup, receive };
}

function errorStack(message: string) {
	const err = new Error(message);
	err.stack = message;
	return err;
}

t.test("Link", async t1 => {
	t1.test("constructor()", async t2 => {
		t2.test("handles PingRequest", async t3 => {
			const { link } = linkPair(control, controller);
			t3.equal(await link.send(new lib.PingRequest()), undefined);
		});

		t2.test("logs invalid messages instead of throwing", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { receive, sent } = controlSide();
			receive({ type: "unknown" });
			t3.strictSame(errors.args(), [["Unhandled message type unknown"]]);
			t3.strictSame(sent, []);
		});

		t2.test("logs the validation errors of invalid messages", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { link, receive } = controlSide();
			link.handle(NumberEvent, async () => {});
			receive(new lib.MessageEvent(1, controller, control, "NumberEvent", "not a number"));
			const args = errors.args();
			t3.equal(args.length, 2);
			t3.equal(args[0][0], "Event NumberEvent failed validation");
			t3.match(args[1][0], /"message": "must be number"/);
		});

		t2.test("emits unexpected errors on the connector", async t3 => {
			const { link, connector, receive } = controlSide();
			t3.capture(link, "_processMessage", () => { throw new Error("boom"); });
			const emitted: Error[] = [];
			connector.on("error", err => { emitted.push(err); });
			receive(new lib.MessageEvent(1, controller, control, "SimpleEvent"));
			t3.match(emitted, [{ message: "boom" }]);
		});

		t2.test("rejects pending requests on close", async t3 => {
			const { link, connector } = controlSide();
			const pending = link.send(new SimpleRequest());
			connector.emit("close");
			await t3.rejects(pending, { constructor: lib.SessionLost, message: "Session Closed" });
			t3.equal(link.pendingRequestCount, 0);
		});

		t2.test("rejects pending requests on invalidate", async t3 => {
			const { link, connector } = controlSide();
			const pending = link.send(new SimpleRequest());
			connector.emit("invalidate");
			await t3.rejects(pending, { constructor: lib.SessionLost, message: "Session Lost" });
		});

		t2.test("sends disconnect ready on disconnectPrepare", async t3 => {
			const connector = new TestWebSocketConnector(control, controller);
			connector._state = "connected";
			const link = new lib.Link(connector);
			link.connector.emit("disconnectPrepare");
			await settle();
			t3.strictSame(connector.sentText.map(text => JSON.parse(text)), [{ type: "disconnect", data: "ready" }]);
		});

		t2.test("sends disconnect ready if prepareDisconnect fails", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const connector = new TestWebSocketConnector(control, controller);
			connector._state = "connected";
			const link = new lib.Link(connector);
			t3.capture(link, "prepareDisconnect", async () => { throw errorStack("Error occured"); });
			connector.emit("disconnectPrepare");
			await settle();
			t3.equal(connector.sentText.length, 1);
			t3.strictSame(errors.args(), [["Unexpected error preparing disconnect:\nError occured"]]);
		});

		t2.test("does not send disconnect ready without a session", async t3 => {
			const connector = new TestWebSocketConnector(control, controller);
			const link = new lib.Link(connector);
			link.connector.emit("disconnectPrepare");
			await settle();
			t3.strictSame(connector.sentText, []);
		});
	});

	t1.test("pendingRequestCount", async t2 => {
		t2.test("counts sent and forwarded requests", async t3 => {
			const { link } = controlSide();
			t3.equal(link.pendingRequestCount, 0);
			link.send(new SimpleRequest()).catch(() => {});
			link.forwardRequest(new lib.MessageRequest(1, addr({ controlId: 2 }), controller, "SimpleRequest"), link);
			t3.equal(link.pendingRequestCount, 2);
		});
	});

	t1.test("send()", async t2 => {
		t2.test("sends a request to the other end", async t3 => {
			const { link, sent } = controlSide();
			link.send(new SimpleRequest());
			t3.strictSame(sent, [
				new lib.MessageRequest(1, new lib.Address(lib.Address.control, 1, 1), controller, "SimpleRequest"),
			]);
		});

		t2.test("sends the data of a request", async t3 => {
			const { link, sent } = controlSide();
			link.send(new NumberRequest(22));
			t3.strictSame(sent, [new lib.MessageRequest(
				1, new lib.Address(lib.Address.control, 1, 1), controller, "NumberRequest", new NumberRequest(22),
			)]);
		});

		t2.test("prefixes the name of plugin requests", async t3 => {
			const { link, sent } = controlSide();
			link.send(new PluginRequest());
			t3.equal(sent[0].name, "link_test:PluginRequest");
		});

		t2.test("gives each request its own id", async t3 => {
			const { link, sent } = controlSide();
			link.send(new SimpleRequest());
			link.send(new SimpleRequest());
			t3.strictSame(sent.map(message => message.src.requestId), [1, 2]);
		});

		t2.test("resolves with the response from the other end", async t3 => {
			const { link, peer } = linkPair(control, controller);
			peer.handle(NumberRequest, async (request, src, dst) => {
				t3.strictSame([src.type, dst], [lib.Address.control, controller]);
				return new NumberResponse(request.value * 2);
			});
			t3.strictSame(await link.send(new NumberRequest(21)), new NumberResponse(42));
			t3.equal(link.pendingRequestCount, 0);
		});

		t2.test("resolves with undefined for requests without a Response", async t3 => {
			const { link, peer } = linkPair(control, controller);
			peer.handle(SimpleRequest, async () => {});
			t3.equal(await link.send(new SimpleRequest()), undefined);
		});

		t2.test("rejects with the error response from the other end", async t3 => {
			const { link, receive, sent } = controlSide();
			const pending = link.send(new SimpleRequest());
			receive(new lib.MessageResponseError(1, controller, sent[0].src, new lib.ResponseError("Error")));
			await t3.rejects(pending, { constructor: lib.InternalServerError, message: "Error" });
			t3.equal(link.pendingRequestCount, 0);
		});

		t2.test("rejects when the response fails validation", async t3 => {
			const { link, receive, sent } = controlSide();
			const pending = link.send(new NumberRequest(1));
			receive(new lib.MessageResponse(1, controller, sent[0].src, "not a number"));
			await t3.rejects(
				pending,
				{ constructor: lib.InvalidMessage, message: "Response for request NumberRequest failed validation" },
			);
		});

		t2.test("throws on data failing validation without sending", async t3 => {
			const { link, sent } = controlSide();
			t3.throws(
				() => link.send(new NumberRequest("bad" as any)),
				{ message: "Request NumberRequest failed validation" },
			);
			t3.throws(
				() => link.send(new NumberEvent("bad" as any)),
				{ message: "Event NumberEvent failed validation" },
			);
			t3.strictSame(sent, []);
		});

		t2.test("skips validation when validateSent is false", async t3 => {
			const { link, sent } = controlSide();
			link.validateSent = false;
			link.send(new NumberRequest("bad" as any));
			link.send(new NumberEvent("bad" as any));
			t3.equal(sent.length, 2);
		});

		t2.test("sends an event to the other end", async t3 => {
			const { link, sent } = controlSide();
			t3.equal(link.send(new SimpleEvent()), undefined);
			t3.strictSame(sent, [new lib.MessageEvent(1, control, controller, "SimpleEvent")]);
		});

		t2.test("sends the data of an event", async t3 => {
			const { link, sent } = controlSide();
			link.send(new NumberEvent(22));
			t3.strictSame(sent, [new lib.MessageEvent(1, control, controller, "NumberEvent", new NumberEvent(22))]);
		});

		t2.test("throws for unregistered requests and events", async t3 => {
			class UnregisteredRequest {
				static type = "request" as const;
				static src = "control" as const;
				static dst = "controller" as const;
			}
			class UnregisteredEvent {
				static type = "event" as const;
				static src = "control" as const;
				static dst = "controller" as const;
			}
			const { link, sent } = controlSide();
			t3.throws(
				() => link.send(new UnregisteredRequest() as any),
				{ message: "Attempt to send unregistered Request UnregisteredRequest" },
			);
			t3.throws(
				() => link.send(new UnregisteredEvent() as any),
				{ message: "Attempt to send unregistered Event UnregisteredEvent" },
			);
			t3.strictSame(sent, []);
		});
	});

	t1.test("sendTo()", async t2 => {
		t2.test("sends to the given address", async t3 => {
			const { link, sent } = controlSide();
			link.sendTo("allControls", new SimpleEvent());
			link.sendTo({ controlId: 2 }, new SimpleRequest()).catch(() => {});
			t3.strictSame(sent.map(message => message.dst), [allControls, addr({ controlId: 2 })]);
		});

		t2.test("throws when the message would return to the sender", async t3 => {
			const { link, sent } = controlSide();
			t3.throws(
				() => link.sendTo(control, new SimpleRequest()),
				{ message: `Message would return back to sender ${control}.` },
			);
			t3.throws(
				() => link.sendTo(control, new SimpleEvent()),
				{ message: `Message would return back to sender ${control}.` },
			);
			t3.equal(link.pendingRequestCount, 0);
			t3.strictSame(sent, []);
		});

		t2.test("throws for objects that are not requests or events", async t3 => {
			class NotAMessage { static type = "other"; }
			const { link } = controlSide();
			t3.throws(
				() => link.sendTo(controller, new NotAMessage() as any),
				{ message: "Expected request or event but got type other" },
			);
		});
	});

	t1.test("handle()", async t2 => {
		t2.test("handles requests", async t3 => {
			const { link, receive, peer } = controlSide();
			const calls: unknown[] = [];
			link.handle(NumberRequest, async (request, src, dst) => {
				calls.push([request, src, dst]);
				return new NumberResponse(request.value + 4);
			});
			const response = nextMessage(peer);
			receive(new lib.MessageRequest(1, controller, control, "NumberRequest", 1));
			t3.strictSame(calls, [[new NumberRequest(1), controller, control]]);
			t3.strictSame(await response, new lib.MessageResponse(1, control, controller, new NumberResponse(5)));
		});

		t2.test("accepts handlers not returning a promise", async t3 => {
			const { link, receive, peer } = controlSide();
			link.handle(NumberRequest, ((request: NumberRequest) => new NumberResponse(request.value)) as any);
			const response = nextMessage(peer);
			receive(new lib.MessageRequest(1, controller, control, "NumberRequest", 3));
			t3.match(await response, { type: "response", data: { value: 3 } });
		});

		t2.test("sends an error response when the handler throws", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { link, receive, peer } = controlSide();
			link.handle(SimpleRequest, async () => { throw errorStack("Error"); });
			const response = nextMessage(peer);
			receive(new lib.MessageRequest(1, controller, control, "SimpleRequest"));
			t3.strictSame(await response, new lib.MessageResponseError(
				1, control, controller, new lib.ResponseError("Error", "InternalServerError", "Error"),
			));
			t3.strictSame(errors.args(), [["Unexpected error responding to SimpleRequest:\nError"]]);
		});

		t2.test("sends an error response when the handler throws synchronously", async t3 => {
			t3.capture(lib.logger, "error");
			const { link, receive, peer } = controlSide();
			link.handle(SimpleRequest, (() => { throw errorStack("Sync"); }) as any);
			const response = nextMessage(peer);
			receive(new lib.MessageRequest(1, controller, control, "SimpleRequest"));
			t3.match(await response, { type: "responseError", data: { message: "Sync" } });
		});

		t2.test("does not log registered errors thrown by the handler", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { link, receive, peer } = controlSide();
			link.handle(SimpleRequest, async () => { throw new lib.NotFoundError("Missing"); });
			const response = nextMessage(peer);
			receive(new lib.MessageRequest(1, controller, control, "SimpleRequest"));
			t3.match(await response, { data: { message: "Missing", code: "NotFoundError" } });
			t3.strictSame(errors.args(), []);
		});

		t2.test("sends an error response when the request fails validation", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { link, receive, peer } = controlSide();
			let called = false;
			link.handle(NumberRequest, async () => { called = true; return new NumberResponse(1); });
			const response = nextMessage(peer);
			receive(new lib.MessageRequest(1, controller, control, "NumberRequest", "not a number"));
			t3.match(await response, {
				type: "responseError",
				data: { message: "Request NumberRequest failed validation", code: "InvalidMessage" },
			});
			t3.equal(called, false);
			const args = errors.args();
			t3.equal(args[0][0], "Request NumberRequest failed validation");
			t3.match(args[1][0], /must be number/);
		});

		t2.test("sends an error response when the response fails validation", async t3 => {
			t3.capture(lib.logger, "error");
			const { link, receive, peer } = controlSide();
			link.handle(NumberRequest, async () => "not a number" as any);
			const response = nextMessage(peer);
			receive(new lib.MessageRequest(1, controller, control, "NumberRequest", 1));
			t3.match(await response, {
				type: "responseError",
				data: { message: "Response for request NumberRequest failed validation", code: "InvalidMessage" },
			});
		});

		t2.test("sends an error response when a request without Response gets a value", async t3 => {
			t3.capture(lib.logger, "error");
			const { link, receive, peer } = controlSide();
			link.handle(SimpleRequest, async () => 1 as any);
			const response = nextMessage(peer);
			receive(new lib.MessageRequest(1, controller, control, "SimpleRequest"));
			t3.match(await response, {
				type: "responseError",
				data: { message: "Expected empty response from SimpleRequest handler", code: "InternalServerError" },
			});
		});

		t2.test("sends the response unchecked when validateSent is false", async t3 => {
			const { link, receive, peer } = controlSide();
			link.validateSent = false;
			link.handle(SimpleRequest, async () => 1 as any);
			const response = nextMessage(peer);
			receive(new lib.MessageRequest(1, controller, control, "SimpleRequest"));
			t3.match(await response, { type: "response", data: 1 });
		});

		t2.test("logs when sending the error response fails", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { link, connector, receive } = controlSide();
			link.handle(SimpleRequest, async () => { throw new lib.NotFoundError("Missing"); });
			t3.capture(connector, "sendResponseError", () => { throw errorStack("Send failed"); });
			receive(new lib.MessageRequest(1, controller, control, "SimpleRequest"));
			await settle();
			t3.strictSame(errors.args(), [["Unexpected error sending error response for SimpleRequest:\nSend failed"]]);
		});

		t2.test("sends an error response for requests without a handler", async t3 => {
			const { receive, sent } = controlSide();
			receive(new lib.MessageRequest(1, controller, control, "SimpleRequest"));
			t3.strictSame(sent, [new lib.MessageResponseError(
				1, control, controller, new lib.ResponseError("No handler for SimpleRequest"),
			)]);
		});

		t2.test("handles events", async t3 => {
			const { link, receive, sent } = controlSide();
			const calls: unknown[] = [];
			link.handle(NumberEvent, async (event, src, dst) => { calls.push([event, src, dst]); });
			receive(new lib.MessageEvent(1, controller, control, "NumberEvent", 9));
			t3.strictSame(calls, [[new NumberEvent(9), controller, control]]);
			t3.strictSame(sent, []);
		});

		t2.test("logs errors from event handlers", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { link, receive } = controlSide();
			link.handle(SimpleEvent, async () => { throw errorStack("Error"); });
			receive(new lib.MessageEvent(1, controller, control, "SimpleEvent"));
			await settle();
			t3.strictSame(errors.args(), [["Unexpected error handling SimpleEvent:\nError"]]);
		});

		t2.test("logs the message of event handler errors without a stack", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { link, receive } = controlSide();
			link.handle(SimpleEvent, async () => {
				const err = new Error("no stack");
				err.stack = undefined;
				throw err;
			});
			receive(new lib.MessageEvent(1, controller, control, "SimpleEvent"));
			await settle();
			t3.strictSame(errors.args(), [["Unexpected error handling SimpleEvent:\nno stack"]]);
		});

		t2.test("logs events without a handler", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { receive, sent } = controlSide();
			receive(new lib.MessageEvent(1, controller, control, "SimpleEvent"));
			t3.strictSame(errors.args(), [["Unhandled event SimpleEvent"]]);
			t3.strictSame(sent, []);
		});

		t2.test("throws on classes of unknown type", async t3 => {
			const { link } = controlSide();
			t3.throws(
				() => link.handle({ name: "Bad", type: "bad" } as any, async () => {}),
				{ message: "Class Bad has unrecognized type bad" },
			);
		});

		t2.test("throws when a handler is already set", async t3 => {
			const { link } = controlSide();
			link.handle(SimpleRequest, async () => {});
			t3.throws(
				() => link.handle(SimpleRequest, async () => {}),
				{ message: "Request SimpleRequest is already registered" },
			);
			link.handle(SimpleEvent, async () => {});
			t3.throws(
				() => link.handle(SimpleEvent, async () => {}),
				{ message: "Event SimpleEvent is already registered" },
			);
		});
	});

	t1.test("handleRequest()", async t2 => {
		t2.test("throws for unregistered requests", async t3 => {
			class Unregistered { static type = "request" as const; }
			const { link } = controlSide();
			t3.throws(
				() => link.handleRequest(Unregistered as any, async () => {}),
				{ message: "Unregistered Request class Unregistered" },
			);
		});
	});

	t1.test("handleEvent()", async t2 => {
		t2.test("throws for unregistered events", async t3 => {
			class Unregistered { static type = "event" as const; }
			const { link } = controlSide();
			t3.throws(
				() => link.handleEvent(Unregistered as any, async () => {}),
				{ message: "Unregistered Event class Unregistered" },
			);
		});
	});

	t1.test("fallbackRequest()", async t2 => {
		t2.test("throws for unregistered requests", async t3 => {
			class Unregistered { static type = "request" as const; }
			const { link } = controlSide();
			t3.throws(
				() => link.fallbackRequest(Unregistered as any, async () => {}),
				{ message: "Unregistered Request class Unregistered" },
			);
		});

		t2.test("throws when a fallback is already set", async t3 => {
			const { link } = controlSide();
			link.fallbackRequest(SimpleRequest, async () => {});
			t3.throws(
				() => link.fallbackRequest(SimpleRequest, async () => {}),
				{ message: "Request SimpleRequest is already fallbacked" },
			);
		});
	});

	t1.test("snoopEvent()", async t2 => {
		t2.test("sees events before the handler", async t3 => {
			const { link, receive } = controlSide();
			const calls: string[] = [];
			link.snoopEvent(NumberEvent, async event => { calls.push(`snoop ${event.value}`); });
			link.handle(NumberEvent, async event => { calls.push(`handle ${event.value}`); });
			receive(new lib.MessageEvent(1, controller, control, "NumberEvent", 2));
			t3.strictSame(calls, ["snoop 2", "handle 2"]);
		});

		t2.test("sees events addressed elsewhere", async t3 => {
			const { link, receive } = controlSide();
			let snooped = false;
			link.snoopEvent(SimpleEvent, async () => { snooped = true; });
			link.router = { forwardMessage: () => true };
			receive(new lib.MessageEvent(1, controller, addr({ controlId: 2 }), "SimpleEvent"));
			t3.equal(snooped, true);
		});

		t2.test("logs errors from the snooper", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { link, receive } = controlSide();
			link.handle(SimpleEvent, async () => {});
			link.snoopEvent(SimpleEvent, async () => { throw errorStack("Error"); });
			receive(new lib.MessageEvent(1, controller, control, "SimpleEvent"));
			await settle();
			t3.strictSame(errors.args(), [["Unexpected error snooping SimpleEvent:\nError"]]);
		});

		t2.test("logs the message of snooper errors without a stack", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { link, receive } = controlSide();
			link.handle(SimpleEvent, async () => {});
			link.snoopEvent(SimpleEvent, async () => {
				const err = new Error("no stack");
				err.stack = undefined;
				throw err;
			});
			receive(new lib.MessageEvent(1, controller, control, "SimpleEvent"));
			await settle();
			t3.strictSame(errors.args(), [["Unexpected error snooping SimpleEvent:\nno stack"]]);
		});

		t2.test("throws for unregistered events", async t3 => {
			class Unregistered { static type = "event" as const; }
			const { link } = controlSide();
			t3.throws(
				() => link.snoopEvent(Unregistered as any, async () => {}),
				{ message: "Unregistered Event class Unregistered" },
			);
		});

		t2.test("throws when a snooper is already set", async t3 => {
			const { link } = controlSide();
			link.snoopEvent(SimpleEvent, async () => {});
			t3.throws(
				() => link.snoopEvent(SimpleEvent, async () => {}),
				{ message: "Event SimpleEvent is already snooped" },
			);
		});
	});

	t1.test("_processMessage()", async t2 => {
		t2.test("throws on unknown message types", async t3 => {
			const { link } = controlSide();
			t3.throws(
				() => link._processMessage({ type: "invalid" } as any),
				{ constructor: lib.InvalidMessage, message: "Unhandled message type invalid" },
			);
		});

		t2.test("request validation", async t3 => {
			const cases: [string, lib.Address, lib.Address, string, string][] = [
				["unrecognized requests", controller, control, "Unknown", "Unrecognized request Unknown"],
				[
					"a src not allowed",
					host,
					control,
					"SimpleRequest",
					`Source ${host} is not allowed for SimpleRequest`,
				],
				[
					"a dst not allowed",
					controller,
					host,
					"SimpleRequest",
					`Destination ${host} is not allowed for SimpleRequest`,
				],
				["a broadcast src", allControls, control, "SimpleRequest", "Message src may not be broadcast"],
				[
					"a broadcast dst",
					controller,
					allControls,
					"SimpleRequest",
					`Destination ${allControls} is not allowed for SimpleRequest`,
				],
			];
			for (const [name, src, dst, request, error] of cases) {
				t3.test(`answers ${name} with an error response`, async t4 => {
					const errors = t4.capture(lib.logger, "error");
					const { link, receive, sent } = controlSide();
					let called = false;
					link.handle(SimpleRequest, async () => { called = true; });
					receive(new lib.MessageRequest(1, src, dst, request));
					t4.strictSame(sent, [new lib.MessageResponseError(
						1, control, src, new lib.ResponseError(error, "InvalidMessage"),
					)]);
					t4.strictSame(errors.args(), [[error]]);
					t4.equal(called, false);
				});
			}
		});

		t2.test("event validation", async t3 => {
			const cases: [string, lib.Address, lib.Address, string, string][] = [
				["unrecognized events", controller, control, "Unknown", "Unrecognized event Unknown"],
				["a src not allowed", host, control, "SimpleEvent", `Source ${host} is not allowed for SimpleEvent`],
				[
					"a dst not allowed",
					controller,
					host,
					"SimpleEvent",
					`Destination ${host} is not allowed for SimpleEvent`,
				],
				["a broadcast src", allControls, control, "SimpleEvent", "Message src may not be broadcast"],
				[
					"a broadcast dst not allowed",
					controller,
					addr("allHosts"),
					"SimpleEvent",
					`Destination ${addr("allHosts")} is not allowed for SimpleEvent`,
				],
			];
			for (const [name, src, dst, event, error] of cases) {
				t3.test(`drops ${name}`, async t4 => {
					const errors = t4.capture(lib.logger, "error");
					const { link, receive, sent } = controlSide();
					let called = false;
					link.snoopEvent(SimpleEvent, async () => { called = true; });
					link.handle(SimpleEvent, async () => { called = true; });
					receive(new lib.MessageEvent(1, src, dst, event));
					t4.strictSame(errors.args(), [[error]]);
					t4.strictSame(sent, []);
					t4.equal(called, false);
				});
			}
		});

		t2.test("answers requests rejected by validateIngress with an error response", async t3 => {
			t3.capture(lib.logger, "error");
			const { link, receive, sent } = controlSide();
			t3.capture(link, "validateIngress", () => { throw new lib.InvalidMessage("Not from here"); });
			receive(new lib.MessageRequest(1, controller, control, "SimpleRequest"));
			receive(new lib.MessageEvent(2, controller, control, "SimpleEvent"));
			t3.strictSame(sent, [new lib.MessageResponseError(
				1, control, controller, new lib.ResponseError("Not from here", "InvalidMessage"),
			)]);
		});

		t2.test("handles a broadcast event addressed to this link", async t3 => {
			const { link, receive } = controlSide();
			let handled = false;
			link.handle(SimpleEvent, async () => { handled = true; });
			receive(new lib.MessageEvent(1, controller, allControls, "SimpleEvent"));
			t3.equal(handled, true);
		});

		t2.test("routes a broadcast event as well as handling it", async t3 => {
			const { link, receive } = controlSide();
			const routed: unknown[] = [];
			let handled = false;
			link.router = { forwardMessage: (...args) => { routed.push(args); return true; } };
			link.handle(SimpleEvent, async () => { handled = true; });
			const message = new lib.MessageEvent(1, controller, allControls, "SimpleEvent");
			receive(message);
			t3.strictSame(routed, [[link, message, lib.Link._eventsByClass.get(SimpleEvent as any), false]]);
			t3.equal(handled, true);
		});

		t2.test("does not route a non broadcast addressed to this link", async t3 => {
			const { link, receive } = controlSide();
			let routed = false;
			link.router = { forwardMessage: () => { routed = true; return true; } };
			link.handle(SimpleEvent, async () => {});
			receive(new lib.MessageEvent(1, controller, control, "SimpleEvent"));
			t3.equal(routed, false);
		});

		t2.test("rejects requests addressed elsewhere on a link which does not route", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { receive, sent } = controllerSide();
			receive(new lib.MessageRequest(1, control, host, "HostRequest"));
			const error = `Received message addressed to ${host} but this link does not route messages`;
			t3.strictSame(sent, [new lib.MessageResponseError(
				1, controller, control, new lib.ResponseError(error, "InvalidMessage"),
			)]);
			t3.strictSame(errors.args(), [[error]]);
		});

		t2.test("drops events addressed elsewhere on a link which does not route", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { receive, sent } = controlSide();
			receive(new lib.MessageEvent(1, controller, addr({ controlId: 2 }), "SimpleEvent"));
			t3.equal(errors.args().length, 1);
			t3.strictSame(sent, []);
		});

		t2.test("passes messages addressed elsewhere to the router", async t3 => {
			const { link, receive } = controllerSide();
			const routed: unknown[] = [];
			link.router = { forwardMessage: (...args) => { routed.push(args); return true; } };
			const message = new lib.MessageRequest(1, control, host, "HostRequest");
			receive(message);
			t3.strictSame(routed, [[link, message, lib.Link._requestsByClass.get(HostRequest as any), false]]);
		});

		t2.test("uses the fallback handler when the router declines", async t3 => {
			const { link, receive, peer } = controllerSide();
			const calls: unknown[] = [];
			link.router = {
				forwardMessage: (_origin, _message, _entry, fallback) => { calls.push(fallback); return false; },
			};
			link.fallbackRequest(HostRequest, async (_request, src, dst) => { calls.push([src, dst]); });
			const response = nextMessage(peer);
			receive(new lib.MessageRequest(1, control, host, "HostRequest"));
			t3.strictSame(calls, [true, [control, host]]);
			t3.strictSame(await response, new lib.MessageResponse(1, host, control), "response is sent as from dst");
		});

		t2.test("emits an error when the router declines without a fallback", async t3 => {
			const { link, connector, receive } = controllerSide();
			const emitted: Error[] = [];
			connector.on("error", err => { emitted.push(err); });
			link.router = { forwardMessage: () => false };
			receive(new lib.MessageRequest(1, control, host, "HostRequest"));
			t3.match(emitted, [{ message: "Router requested fallback handling when fallback is unavailable" }]);
		});

		t2.test("forgets the forwarded request when its response passes", async t3 => {
			const { link, receive } = controllerSide();
			link.router = { forwardMessage: () => true };
			const requestSrc = new lib.Address(lib.Address.control, 1, 7);
			link.forwardRequest(new lib.MessageRequest(1, requestSrc, host, "HostRequest"), link);
			t3.equal(link.pendingRequestCount, 1);
			receive(new lib.MessageResponse(1, host, requestSrc));
			t3.equal(link.pendingRequestCount, 0);
		});

		t2.test("logs responses without a pending request", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { receive } = controlSide();
			const dst = new lib.Address(lib.Address.control, 1, 5);
			receive(new lib.MessageResponse(1, controller, dst));
			receive(new lib.MessageResponseError(2, controller, dst, new lib.ResponseError("Error")));
			t3.strictSame(errors.args(), [
				[`Received response 5 from ${controller} without a pending request`],
				[`Received error response 5 from ${controller} without a pending request`],
			]);
		});

		t2.test("ignores responses from a different address than the request went to", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { link, receive, sent } = controlSide();
			const pending = link.sendTo(addr({ controlId: 2 }), new SimpleRequest());
			receive(new lib.MessageResponse(1, addr({ controlId: 3 }), sent[0].src));
			t3.equal(link.pendingRequestCount, 1);
			t3.match(errors.args(), [[/^Received reply from \[Address control:3\] for message sent to/]]);
			receive(new lib.MessageResponse(2, addr({ controlId: 2 }), sent[0].src));
			await pending;
		});

		t2.test("permissions", async t3 => {
			t3.test("checks requests and events received from a control", async t4 => {
				const { link, receive } = controllerSide();
				const checks = t4.capture(link, "validatePermission");
				let handled = 0;
				link.handle(SimpleRequest, async () => { handled += 1; });
				link.handle(SimpleEvent, async () => { handled += 1; });
				receive(new lib.MessageRequest(1, control, controller, "SimpleRequest"));
				receive(new lib.MessageEvent(2, control, controller, "SimpleEvent"));
				t4.strictSame(checks.args().map(([message, entry]) => [message.name, entry.name]), [
					["SimpleRequest", "SimpleRequest"], ["SimpleEvent", "SimpleEvent"],
				]);
				t4.equal(handled, 2);
			});

			t3.test("does not check messages on other links", async t4 => {
				const { link, receive } = controlSide();
				const checks = t4.capture(link, "validatePermission");
				link.handle(SimpleEvent, async () => {});
				receive(new lib.MessageEvent(1, controller, control, "SimpleEvent"));
				t4.strictSame(checks.args(), []);
			});

			t3.test("silently drops messages denied with a ClientError", async t4 => {
				const errors = t4.capture(lib.logger, "error");
				const { link, connector, receive, sent } = controllerSide();
				const emitted: Error[] = [];
				connector.on("error", err => { emitted.push(err); });
				t4.capture(link, "validatePermission", () => { throw new lib.PermissionError("Denied"); });
				let handled = false;
				link.handle(SimpleRequest, async () => { handled = true; });
				receive(new lib.MessageRequest(1, control, controller, "SimpleRequest"));
				t4.equal(handled, false);
				t4.strictSame(emitted, []);
				t4.strictSame(sent, []);
				t4.strictSame(errors.args(), []);
			});

			t3.test("logs and drops messages when the check throws another error", async t4 => {
				const errors = t4.capture(lib.logger, "error");
				const { link, connector, receive } = controllerSide();
				const emitted: Error[] = [];
				connector.on("error", err => { emitted.push(err); });
				t4.capture(link, "validatePermission", () => { throw errorStack("check is broken"); });
				let handled = false;
				link.handle(SimpleRequest, async () => { handled = true; });
				receive(new lib.MessageRequest(1, control, controller, "SimpleRequest"));
				t4.equal(handled, false);
				t4.strictSame(emitted, []);
				t4.strictSame(
					errors.args(),
					[["Unexpected error checking permission for SimpleRequest:\ncheck is broken"]],
				);
			});

			t3.test("logs the message of non-ClientErrors without a stack", async t4 => {
				const errors = t4.capture(lib.logger, "error");
				const { link, receive } = controllerSide();
				t4.capture(link, "validatePermission", () => {
					const err = new Error("no stack");
					err.stack = undefined;
					throw err;
				});
				receive(new lib.MessageEvent(1, control, controller, "SimpleEvent"));
				t4.strictSame(errors.args(), [["Unexpected error checking permission for SimpleEvent:\nno stack"]]);
			});
		});
	});

	t1.test("forwardRequest()", async t2 => {
		// The request is recorded so its response can be sent back the way it came, see #650.
		function forwarding() {
			const origin = recordedLink(controller, control);
			const nextHop = recordedLink(controller, host);
			const message = new lib.MessageRequest(1, new lib.Address(lib.Address.control, 1, 3), host, "HostRequest");
			return { origin, nextHop, message };
		}

		t2.test("sends the request on and records it", async t3 => {
			const { origin, nextHop, message } = forwarding();
			nextHop.link.forwardRequest(message, origin.link);
			t3.equal(nextHop.link.pendingRequestCount, 1);
			t3.strictSame(nextHop.sent, [message]);
		});

		t2.test("does not record a request it failed to forward", async t3 => {
			const { origin, nextHop, message } = forwarding();
			t3.capture(nextHop.connector, "forward", () => { throw new Error("Session Closed"); });
			t3.throws(() => nextHop.link.forwardRequest(message, origin.link), { message: "Session Closed" });
			t3.equal(nextHop.link.pendingRequestCount, 0);
			nextHop.connector.emit("close");
			t3.strictSame(origin.sent, [], "failed request is not answered again on close");
		});
	});

	t1.test("prepareDisconnect()", async t2 => {
		t2.test("waits for pending requests to settle", async t3 => {
			const { link, receive, sent } = controlSide();
			const answered = link.send(new SimpleRequest());
			const failed = link.send(new SimpleRequest());
			failed.catch(() => {});
			let done = false;
			const prepared = link.prepareDisconnect().then(() => { done = true; });
			await settle();
			t3.equal(done, false);
			receive(new lib.MessageResponse(1, controller, sent[0].src));
			receive(new lib.MessageResponseError(2, controller, sent[1].src, new lib.ResponseError("Error")));
			await prepared;
			await answered;
			t3.equal(done, true);
		});
	});

	t1.test("_clearPendingRequests()", async t2 => {
		t2.test("answers forwarded requests with the error", async t3 => {
			const origin = recordedLink(controller, control);
			const nextHop = recordedLink(controller, host);
			const requestSrc = new lib.Address(lib.Address.control, 1, 3);
			nextHop.link.forwardRequest(new lib.MessageRequest(1, requestSrc, host, "HostRequest"), origin.link);
			nextHop.link._clearPendingRequests(new lib.SessionLost("Session Lost"));
			t3.strictSame(origin.sent, [new lib.MessageResponseError(
				1, host, requestSrc, new lib.ResponseError("Session Lost", "SessionLost"),
			)]);
			t3.equal(nextHop.link.pendingRequestCount, 0);
		});

		t2.test("does not answer origins whose WebSocket session has ended", async t3 => {
			const originConnector = new TestWebSocketConnector(controller, control);
			const origin = new lib.Link(originConnector);
			const nextHop = recordedLink(controller, host);
			const requestSrc = new lib.Address(lib.Address.control, 1, 3);
			nextHop.link.forwardRequest(new lib.MessageRequest(1, requestSrc, host, "HostRequest"), origin);
			nextHop.link._clearPendingRequests(new lib.SessionLost("Session Lost"));
			t3.strictSame(originConnector.sentText, []);
			t3.equal(nextHop.link.pendingRequestCount, 0);
		});
	});

	t1.test("routing", async t2 => {
		// control 1 <-> controller <-> host 1, with the controller forwarding between the two
		function chain() {
			const client = linkPair(control, controller);
			const hostLinks = linkPair(controller, host);
			const controlSideLink = client.peer;
			const hostSideLink = hostLinks.link;
			controlSideLink.router = {
				forwardMessage(origin, message) {
					hostSideLink.forwardRequest(message as lib.MessageRequest, origin);
					return true;
				},
			};
			hostSideLink.router = {
				forwardMessage(_origin, message) {
					controlSideLink.connector.forward(message);
					return true;
				},
			};
			return { client: client.link, host: hostLinks.peer, hostSideLink };
		}

		t2.test("delivers a request and its response through a router", async t3 => {
			const { client, host: hostLink, hostSideLink } = chain();
			hostLink.handle(HostRequest, async (_request, src) => { t3.equal(src.type, lib.Address.control); });
			await client.sendTo(host, new HostRequest());
			t3.equal(hostSideLink.pendingRequestCount, 0);
		});

		class UnregisteredConflict extends lib.ConflictError { }
		const errorCases: [string, Error, Function, number][] = [
			["the class thrown by the handler", new lib.NotFoundError("Thing does not exist"), lib.NotFoundError, 0],
			["a registered plugin error class", new TestPluginError("Plugin conflict"), TestPluginError, 0],
			["the closest registered class", new UnregisteredConflict("Busy"), lib.ConflictError, 0],
			["InternalServerError for unregistered", new TypeError("x is not a function"), lib.InternalServerError, 1],
		];
		for (const [name, err, Expected, logged] of errorCases) {
			t2.test(`rejects with ${name}`, async t3 => {
				const errors = t3.capture(lib.logger, "error");
				const { client, host: hostLink } = chain();
				hostLink.handle(HostRequest, async () => { throw err; });
				await t3.rejects(
					client.sendTo(host, new HostRequest()),
					{ constructor: Expected, message: err.message, stack: err.stack },
				);
				t3.equal(errors.args().length, logged, "logged unexpected errors only");
			});
		}
	});

	t1.test("Link.register()", async t2 => {
		t2.test("registers requests by name and class", async t3 => {
			const entry = lib.Link._requestsByName.get("NumberRequest")!;
			t3.equal(lib.Link._requestsByClass.get(NumberRequest as any), entry);
			t3.strictSame(entry.allowedSrcTypes, new Set([lib.Address.controller, lib.Address.control]));
			t3.equal(entry.Response, NumberResponse);
		});

		t2.test("registers plugin messages with the plugin prefix", async t3 => {
			t3.equal(lib.Link._requestsByName.get("link_test:PluginRequest")?.Request, PluginRequest);
			t3.equal(lib.Link._requestsByName.has("PluginRequest"), false);
		});

		t2.test("accepts a single type for src and dst", async t3 => {
			t3.strictSame(lib.Link._eventsByName.get("HostEvent")!.allowedDstTypes, new Set([lib.Address.host]));
		});

		const base = { src: "controller", dst: "control" };
		const failures: [string, object, string][] = [
			["an unknown type", { type: "bad" }, "Data class Bad has unknown type bad"],
			[
				"a request already registered",
				{ name: "SimpleRequest", type: "request" },
				"Request SimpleRequest is already registered",
			],
			[
				"an event already registered",
				{ name: "SimpleEvent", type: "event" },
				"Event SimpleEvent is already registered",
			],
			[
				"a request with jsonSchema but no fromJSON",
				{ type: "request", jsonSchema: {} },
				"Request Bad has static jsonSchema but is missing static fromJSON",
			],
			[
				"a request with fromJSON but no jsonSchema",
				{ type: "request", fromJSON() {} },
				"Request Bad has static fromJSON but is missing static jsonSchema",
			],
			[
				"an event with jsonSchema but no fromJSON",
				{ type: "event", jsonSchema: {} },
				"Event Bad has static jsonSchema but is missing static fromJSON",
			],
			[
				"an event with fromJSON but no jsonSchema",
				{ type: "event", fromJSON() {} },
				"Event Bad has static fromJSON but is missing static jsonSchema",
			],
			[
				"a Response without jsonSchema",
				{ type: "request", Response: { fromJSON() {} } },
				"Response for Request Bad is missing static jsonSchema",
			],
			[
				"a Response without fromJSON",
				{ type: "request", Response: { jsonSchema: {} } },
				"Response for Request Bad is missing static fromJSON",
			],
			["a missing src", { type: "event", src: undefined }, "Missing src specification in Bad"],
			["a missing dst", { type: "request", dst: undefined }, "Missing dst specification in Bad"],
			[
				"an invalid address type",
				{ type: "event", src: ["controller", "nowhere"] },
				"Invalid type nowhere in src specification of Bad",
			],
			[
				"a broadcast address type",
				{ type: "request", dst: "broadcast" },
				"dst specification may not use the broadcast type in Bad",
			],
			[
				"a request from control without permission",
				{ type: "request", src: "control" },
				"Invalid permission specification undefined on Bad",
			],
			[
				"an event from control with a bad permission",
				{ type: "event", src: "control", permission: 1 },
				"Invalid permission specification number on Bad",
			],
		];
		for (const [name, props, message] of failures) {
			t2.test(`throws for ${name}`, async t3 => {
				const { name: className = "Bad", ...rest } = props as { name?: string };
				const Class = Object.assign(class Bad {}, base, rest);
				Object.defineProperty(Class, "name", { value: className });
				const requests = lib.Link._requestsByName.size;
				const events = lib.Link._eventsByName.size;
				t3.throws(() => lib.Link.register(Class as any), { message });
				t3.equal(lib.Link._requestsByName.size, requests, "no request registered");
				t3.equal(lib.Link._eventsByName.size, events, "no event registered");
			});
		}
	});

	t1.test("Link.registerError()", async t2 => {
		t2.test("throws when the name is already registered", async t3 => {
			t3.throws(
				() => lib.Link.registerError(lib.NotFoundError),
				{ message: "Error NotFoundError is already registered" },
			);
		});
	});

	t1.test("Link.errorName()", async t2 => {
		t2.test("returns the registered name of the closest class", async t3 => {
			class Unregistered extends lib.NotFoundError { }
			t3.equal(lib.Link.errorName(new lib.NotFoundError("a")), "NotFoundError");
			t3.equal(lib.Link.errorName(new Unregistered("a")), "NotFoundError");
			t3.equal(lib.Link.errorName(new TestPluginError("a")), "link_test:TestPluginError");
			t3.equal(lib.Link.errorName(new Error("a")), undefined);
		});
	});

	t1.test("Link.errorToResponse()", async t2 => {
		t2.test("includes the stack unless told not to", async t3 => {
			const err = new lib.NotFoundError("Missing");
			t3.strictSame(lib.Link.errorToResponse(err), new lib.ResponseError("Missing", "NotFoundError", err.stack));
			t3.strictSame(lib.Link.errorToResponse(err, false), new lib.ResponseError("Missing", "NotFoundError"));
		});

		t2.test("uses InternalServerError for unregistered errors", async t3 => {
			t3.equal(lib.Link.errorToResponse(new Error("a")).code, "InternalServerError");
		});
	});

	t1.test("Link.errorFromResponse()", async t2 => {
		t2.test("creates the registered class", async t3 => {
			const err = lib.Link.errorFromResponse(new lib.ResponseError("Missing", "NotFoundError", "stack"));
			t3.type(err, lib.NotFoundError);
			t3.match(err, { message: "Missing", stack: "stack" });
		});

		t2.test("keeps the local stack when the response has none", async t3 => {
			const err = lib.Link.errorFromResponse(new lib.ResponseError("Missing", "NotFoundError"));
			t3.match(err.stack, /^Error: Missing\n\s+at /);
		});

		t2.test("uses InternalServerError for unknown and missing names", async t3 => {
			t3.type(
				lib.Link.errorFromResponse(new lib.ResponseError("Gone", "other_plugin:GoneError")),
				lib.InternalServerError,
			);
			t3.type(lib.Link.errorFromResponse(new lib.ResponseError("Gone")), lib.InternalServerError);
		});
	});
});

t.test("registerPluginMessages()", async t1 => {
	t1.test("registers messages under the plugin name", async t2 => {
		t2.equal(lib.Link._requestsByName.get("link_test:PluginRequest")?.Request, PluginRequest);
		t2.equal(lib.Link._eventsByName.get("link_test:PluginEvent")?.Event, PluginEvent);
		t2.equal(lib.Link._eventsByName.has("PluginEvent"), false);
	});

	t1.test("requires messages to set the plugin property", async t2 => {
		class MissingPluginEvent {
			static type = "event" as const;
			static src = "controller" as const;
			static dst = "host" as const;
		}
		t2.throws(
			() => lib.registerPluginMessages([{ name: "other", messages: [MissingPluginEvent] } as any]),
			{ message: /^Expected message MissingPluginEvent from other to have a static plugin property/ },
		);
		t2.equal(lib.Link._eventsByClass.has(MissingPluginEvent as any), false);
	});

	t1.test("requires errors to set the plugin property", async t2 => {
		class MissingPluginError extends lib.ClientError { }
		t2.throws(
			() => lib.registerPluginMessages([{ name: "other", errors: [MissingPluginError] } as any]),
			{ message: /^Expected error MissingPluginError from other to have a static plugin property/ },
		);
	});
});
