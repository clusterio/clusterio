import crypto from "node:crypto";
import events from "node:events";
import http from "node:http";
import type net from "node:net";
import t from "tap";
import * as lib from "@clusterio/lib";
import { TestWebSocketConnector, addr } from "../../shared/link.ts";

const control = addr({ controlId: 1 });
const controller = addr("controller");

class PlainRequest {
	declare ["constructor"]: typeof PlainRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
}
class PluginDataRequest {
	declare ["constructor"]: typeof PluginDataRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "connector_test";
	value: number;
	constructor(value: number) { this.value = value; }
	static jsonSchema = { type: "number" };
	toJSON() { return this.value; }
	static fromJSON(json: number) { return new this(json); }
}
class PlainEvent {
	declare ["constructor"]: typeof PlainEvent;
	static type = "event" as const;
	static src = "control" as const;
	static dst = "controller" as const;
}
class PluginDataEvent {
	declare ["constructor"]: typeof PluginDataEvent;
	static type = "event" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "connector_test";
	value: number;
	constructor(value: number) { this.value = value; }
	static jsonSchema = { type: "number" };
	toJSON() { return this.value; }
	static fromJSON(json: number) { return new this(json); }
}

type State = lib.WebSocketClientConnector["_state"];

/** Stands in for a ws WebSocket, the connector assigns the on* handlers */
class FakeSocket {
	sent: string[] = [];
	closed: [number, string][] = [];
	terminated = false;
	onclose: any = null;
	onerror: any = null;
	onopen: any = null;
	onmessage: any = null;
	send(text: string) { this.sent.push(text); }
	close(code: number, reason: string) { this.closed.push([code, reason]); }
	terminate() { this.terminated = true; }
	sentJson() { return this.sent.map(text => JSON.parse(text)); }
}

class TestClientConnector extends lib.WebSocketClientConnector {
	registered = 0;
	register() { this.registered += 1; }
}

// Client connector with a fake socket attached, in the given state
function client(state: State = "connecting") {
	const connector = new TestClientConnector("http://localhost/", 1);
	const socket = new FakeSocket();
	connector._socket = socket as any;
	connector._attachSocketHandlers();
	connector._state = state;
	return { connector, socket };
}

// Base connector with a fake socket, in the given state
function base(state: State = "connected") {
	const connector = new TestWebSocketConnector(control, controller);
	const socket = new FakeSocket();
	connector._socket = socket as any;
	connector._state = state;
	return { connector, socket };
}

function emitted(emitter: events.EventEmitter, ...names: string[]) {
	const seen: [string, ...any[]][] = [];
	for (const name of names) {
		emitter.on(name, (...args: any[]) => { seen.push([name, ...args]); });
	}
	return seen;
}

function textEvent(seq: number, text: string) {
	return new lib.MessageEvent(seq, control, controller, "TestEvent", { text });
}

function utf8Size(message: unknown) {
	return Buffer.byteLength(JSON.stringify(message), "utf8");
}

function ready(heartbeatInterval = 10) {
	return new lib.MessageReady(new lib.ReadyData(control, "token", 60, heartbeatInterval));
}

function hello() {
	return new lib.MessageHello(new lib.HelloData("2.0.0", {}));
}

/**
 * Minimal WebSocket server, sends the given text frames on connect and
 * answers close frames. Refuses paths under /refuse/.
 */
async function wsServer(t1: any, frames: string[]) {
	const urls: string[] = [];
	const sockets = new Set<net.Socket>();
	const server = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
	server.on("upgrade", (req, socket: net.Socket) => {
		urls.push(req.url!);
		sockets.add(socket);
		if (req.url!.startsWith("/refuse/")) {
			socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
			return;
		}
		const accept = crypto.createHash("sha1")
			.update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
			.digest("base64");
		socket.write(
			"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
			`Sec-WebSocket-Accept: ${accept}\r\n\r\n`
		);
		for (const text of frames) {
			const payload = Buffer.from(text);
			const header = Buffer.from([0x81, 126, 0, 0]);
			header.writeUInt16BE(payload.length, 2);
			socket.write(Buffer.concat([header, payload]));
		}
		socket.on("data", data => {
			// Client frames are masked, the first byte is still FIN + opcode
			if (data[0] === 0x88) {
				socket.end(Buffer.from([0x88, 0]));
			}
		});
	});
	server.listen(0, "127.0.0.1");
	await events.once(server, "listening");
	t1.teardown(() => {
		for (const socket of sockets) { socket.destroy(); }
		server.close();
	});
	const port = (server.address() as net.AddressInfo).port;
	return { url: `http://127.0.0.1:${port}/`, urls };
}

t.test("BaseConnector", async t1 => {
	t1.test("forward()", async t2 => {
		t2.test("renumbers each routable message type", async t3 => {
			const [connector, peer] = lib.VirtualConnector.makePair(control, controller);
			const received: lib.Message[] = [];
			peer.on("message", message => { received.push(message); });
			const error = new lib.ResponseError("Failed", "Code");
			const seqs = [
				connector.forward(new lib.MessageRequest(7, control, controller, "Name", { a: 1 })),
				connector.forward(new lib.MessageResponse(8, controller, control, { b: 2 })),
				connector.forward(new lib.MessageResponseError(9, controller, control, error)),
				connector.forward(new lib.MessageEvent(10, control, controller, "Event", { c: 3 })),
			];
			t3.strictSame(seqs, [1, 2, 3, 4]);
			t3.strictSame(received, [
				new lib.MessageRequest(1, control, controller, "Name", { a: 1 }),
				new lib.MessageResponse(2, controller, control, { b: 2 }),
				new lib.MessageResponseError(3, controller, control, error),
				new lib.MessageEvent(4, control, controller, "Event", { c: 3 }),
			]);
		});
		t2.test("rejects messages that are not routable", async t3 => {
			const [connector] = lib.VirtualConnector.makePair(control, controller);
			t3.throws(
				() => connector.forward(new lib.MessageHeartbeat(1) as any),
				new Error("Cannot forward message type heartbeat")
			);
		});
	});

	t1.test("sendRequest()", async t2 => {
		t2.test("sends a request without data from the request id", async t3 => {
			const [connector, peer] = lib.VirtualConnector.makePair(control, controller);
			const received: lib.Message[] = [];
			peer.on("message", message => { received.push(message); });
			t3.equal(connector.sendRequest(new PlainRequest(), 5, controller), 1);
			t3.strictSame(received, [
				new lib.MessageRequest(1, new lib.Address(lib.Address.control, 1, 5), controller, "PlainRequest"),
			]);
		});
		t2.test("prefixes plugin requests and includes data", async t3 => {
			const [connector, peer] = lib.VirtualConnector.makePair(control, controller);
			const received: any[] = [];
			peer.on("message", message => { received.push(message); });
			const request = new PluginDataRequest(42);
			connector.sendRequest(request, 6, controller);
			t3.equal(received[0].name, "connector_test:PluginDataRequest");
			t3.equal(received[0].data, request);
		});
	});

	t1.test("sendResponse()", async t2 => {
		t2.test("sends from the connector by default", async t3 => {
			const [connector, peer] = lib.VirtualConnector.makePair(controller, control);
			const received: lib.Message[] = [];
			peer.on("message", message => { received.push(message); });
			connector.sendResponse({ ok: true }, control);
			connector.sendResponse(1, control, addr({ hostId: 3 }));
			t3.strictSame(received, [
				new lib.MessageResponse(1, controller, control, { ok: true }),
				new lib.MessageResponse(2, addr({ hostId: 3 }), control, 1),
			]);
		});
	});

	t1.test("sendResponseError()", async t2 => {
		t2.test("sends from the connector by default", async t3 => {
			const [connector, peer] = lib.VirtualConnector.makePair(controller, control);
			const received: lib.Message[] = [];
			peer.on("message", message => { received.push(message); });
			const error = new lib.ResponseError("Failed");
			connector.sendResponseError(error, control);
			connector.sendResponseError(error, control, addr({ hostId: 3 }));
			t3.strictSame(received, [
				new lib.MessageResponseError(1, controller, control, error),
				new lib.MessageResponseError(2, addr({ hostId: 3 }), control, error),
			]);
		});
	});

	t1.test("sendEvent()", async t2 => {
		t2.test("sends events with and without data", async t3 => {
			const [connector, peer] = lib.VirtualConnector.makePair(control, controller);
			const received: lib.Message[] = [];
			peer.on("message", message => { received.push(message); });
			const event = new PluginDataEvent(3);
			connector.sendEvent(new PlainEvent(), controller);
			connector.sendEvent(event, controller);
			t3.strictSame(received, [
				new lib.MessageEvent(1, control, controller, "PlainEvent"),
				new lib.MessageEvent(2, control, controller, "connector_test:PluginDataEvent", event),
			]);
		});
	});

	t1.test("_reset()", async t2 => {
		t2.test("restarts the sequence and emits reset", async t3 => {
			const [connector] = lib.VirtualConnector.makePair(control, controller);
			const seen = emitted(connector, "reset", "invalidate");
			connector.sendEvent(new PlainEvent(), controller);
			connector._reset();
			t3.strictSame(seen, [["reset"]]);
			t3.equal(connector.sendEvent(new PlainEvent(), controller), 1);
		});
	});

	t1.test("_invalidate()", async t2 => {
		t2.test("restarts the sequence and emits invalidate", async t3 => {
			const [connector] = lib.VirtualConnector.makePair(control, controller);
			const seen = emitted(connector, "reset", "invalidate");
			connector.sendEvent(new PlainEvent(), controller);
			connector._invalidate();
			t3.strictSame(seen, [["invalidate"]]);
			t3.equal(connector.sendEvent(new PlainEvent(), controller), 1);
		});
	});
});

t.test("VirtualConnector", async t1 => {
	t1.test("makePair()", async t2 => {
		t2.test("links two connectors with swapped addresses", async t3 => {
			const [obverse, reverse] = lib.VirtualConnector.makePair(control, controller);
			t3.equal(obverse.other, reverse);
			t3.equal(reverse.other, obverse);
			t3.equal(obverse.src, control);
			t3.equal(obverse.dst, controller);
			t3.equal(reverse.src, controller);
			t3.equal(reverse.dst, control);
		});
	});
	t1.test("send()", async t2 => {
		t2.test("delivers to itself when not paired", async t3 => {
			const connector = new lib.VirtualConnector(control, controller);
			const received: lib.Message[] = [];
			connector.on("message", message => { received.push(message); });
			const message = new lib.MessageHeartbeat(1);
			connector.send(message);
			t3.strictSame(received, [message]);
		});
	});
	t1.test("valid", async t2 => {
		t2.test("is always true", async t3 => {
			t3.equal(new lib.VirtualConnector(control, controller).valid, true);
		});
	});
});

t.test("WebSocketBaseConnector", async t1 => {
	t1.test("_check()", async t2 => {
		t2.test("throws when not in an expected state", async t3 => {
			const { connector } = base("closed");
			t3.throws(
				() => connector._check("connected", "resuming"),
				new Error("Expected state connected,resuming but state is closed")
			);
			connector._check("closed");
		});
	});

	t1.test("_dropSendBufferSeq()", async t2 => {
		function buffered() {
			const { connector } = base();
			connector._sendBuffer = [
				{ seq: 1, text: "a", size: 1 },
				{ seq: 2, text: "bb", size: 2 },
				{ seq: 4, text: "cccc", size: 4 },
			];
			connector._sendBufferSize = 7;
			return connector;
		}
		t2.test("does nothing without a sequence", async t3 => {
			const connector = buffered();
			connector._dropSendBufferSeq(undefined);
			t3.equal(connector._sendBuffer.length, 3);
			t3.equal(connector._sendBufferSize, 7);
		});
		t2.test("drops up to and including the sequence", async t3 => {
			const connector = buffered();
			connector._dropSendBufferSeq(2);
			t3.strictSame(connector._sendBuffer.map(entry => entry.seq), [4]);
			t3.equal(connector._sendBufferSize, 4);
		});
		t2.test("handles holes in the sequence", async t3 => {
			const connector = buffered();
			connector._dropSendBufferSeq(3);
			t3.strictSame(connector._sendBuffer.map(entry => entry.seq), [4]);
		});
		t2.test("drops everything past the last sequence", async t3 => {
			const connector = buffered();
			connector._dropSendBufferSeq(10);
			t3.equal(connector._sendBuffer.length, 0);
			t3.equal(connector._sendBufferSize, 0);
		});
	});

	t1.test("_parseMessage()", async t2 => {
		t2.test("closes on malformed JSON", async t3 => {
			const { connector } = base();
			const close = t3.capture(connector, "close", async () => {});
			t3.equal(connector._parseMessage("{not json"), undefined);
			t3.strictSame(close.args(), [[lib.ConnectionClosed.MalformedMessage, "Malformed JSON"]]);
		});
		t2.test("closes on an invalid message", async t3 => {
			const { connector } = base();
			const errors = t3.capture(lib.logger, "error");
			const close = t3.capture(connector, "close", async () => {});
			t3.equal(connector._parseMessage('{"type":"bogus"}'), undefined);
			t3.strictSame(errors.args(), [['Received malformed message: {"type":"bogus"}']]);
			t3.strictSame(close.args(), [[lib.ConnectionClosed.MalformedMessage, "Malformed message"]]);
		});
		t2.test("returns the parsed message", async t3 => {
			const { connector } = base();
			t3.strictSame(connector._parseMessage('{"type":"heartbeat","seq":3}'), new lib.MessageHeartbeat(3));
		});
	});

	t1.test("_processMessage()", async t2 => {
		t2.test("records heartbeats and drops acknowledged messages", async t3 => {
			const { connector } = base();
			t3.capture(Date, "now", () => 1234);
			connector._sendBuffer = [{ seq: 1, text: "a", size: 1 }, { seq: 2, text: "b", size: 1 }];
			connector._sendBufferSize = 2;
			const seen = emitted(connector, "message");
			connector._processMessage(new lib.MessageHeartbeat(1));
			t3.equal(connector._lastHeartbeatMs, 1234);
			t3.strictSame(connector._sendBuffer.map(entry => entry.seq), [2]);
			t3.strictSame(seen, []);
		});
		t2.test("emits disconnectReady", async t3 => {
			const { connector } = base();
			const seen = emitted(connector, "disconnectReady", "disconnectPrepare");
			connector._processMessage(new lib.MessageDisconnect("ready"));
			t3.strictSame(seen, [["disconnectReady"]]);
			t3.equal(connector._closing, false);
		});
		t2.test("sets closing and emits disconnectPrepare", async t3 => {
			const { connector } = base();
			const seen = emitted(connector, "disconnectReady", "disconnectPrepare");
			connector._processMessage(new lib.MessageDisconnect("prepare"));
			t3.strictSame(seen, [["disconnectPrepare"]]);
			t3.equal(connector._closing, true);
		});
		t2.test("ignores unknown disconnect data", async t3 => {
			const { connector } = base();
			const seen = emitted(connector, "disconnectReady", "disconnectPrepare", "message");
			connector._processMessage(new lib.MessageDisconnect("other"));
			t3.strictSame(seen, []);
		});
		t2.test("emits other messages and records their sequence", async t3 => {
			const { connector } = base();
			const seen = emitted(connector, "message");
			const event = textEvent(5, "x");
			connector._processMessage(event);
			t3.equal(connector._lastReceivedSeq, 5);
			const message = hello();
			connector._processMessage(message);
			t3.equal(connector._lastReceivedSeq, 5);
			t3.strictSame(seen, [["message", event], ["message", message]]);
		});
	});

	t1.test("_doHeartbeat()", async t2 => {
		function beating() {
			const setup = base();
			setup.connector._heartbeatInterval = 10;
			setup.connector._lastHeartbeatMs = 1000;
			setup.connector._lastReceivedSeq = 4 as any;
			return setup;
		}
		t2.test("requires a connection", async t3 => {
			const { connector } = base("resuming");
			t3.throws(() => connector._doHeartbeat(), new Error("Expected state connected but state is resuming"));
		});
		t2.test("sends a heartbeat with the last received sequence", async t3 => {
			const { connector, socket } = beating();
			t3.capture(Date, "now", () => 1000 + 20000);
			connector._doHeartbeat();
			t3.strictSame(socket.sentJson(), [{ type: "heartbeat", seq: 4 }]);
			t3.equal(socket.terminated, false);
		});
		t2.test("terminates the socket after two missed intervals", async t3 => {
			const { connector, socket } = beating();
			t3.capture(Date, "now", () => 1000 + 20001);
			const verbose = t3.capture(lib.logger, "verbose");
			connector._doHeartbeat();
			t3.equal(socket.terminated, true);
			t3.strictSame(socket.sent, []);
			t3.strictSame(verbose.args(), [["Connector | closing after heartbeat timed out"]]);
		});
		t2.test("closes the socket in the browser", async t3 => {
			const { connector, socket } = beating();
			t3.capture(Date, "now", () => 1000 + 20001);
			t3.capture(lib.logger, "verbose");
			const previous = process.env.APP_ENV;
			process.env.APP_ENV = "browser";
			t3.teardown(() => {
				if (previous === undefined) { delete process.env.APP_ENV; } else { process.env.APP_ENV = previous; }
			});
			connector._doHeartbeat();
			t3.equal(socket.terminated, false);
			t3.strictSame(socket.closed, [[lib.ConnectionClosed.Timeout, "Heartbeat timeout"]]);
		});
	});

	t1.test("startHeartbeat()", async t2 => {
		t2.test("calls _doHeartbeat on the interval", async t3 => {
			const { connector, socket } = base();
			connector._heartbeatInterval = 15;
			t3.capture(Date, "now", () => 5000);
			const timers = t3.capture(globalThis, "setInterval", (() => 99) as any);
			connector.startHeartbeat();
			timers.restore();
			const [[callback, ms]] = timers.args() as any;
			t3.equal(ms, 15000);
			t3.equal(connector._lastHeartbeatMs, 5000);
			t3.equal(connector._heartbeatId, 99);
			callback();
			t3.strictSame(socket.sentJson(), [{ type: "heartbeat" }]);
			connector._heartbeatId = null;
		});
		t2.test("throws if already running", async t3 => {
			const { connector } = base();
			connector._heartbeatInterval = 60;
			connector.startHeartbeat();
			t3.teardown(() => connector.stopHeartbeat());
			t3.throws(() => connector.startHeartbeat(), new Error("heartbeat is already running"));
		});
	});

	t1.test("stopHeartbeat()", async t2 => {
		t2.test("clears the interval and can be called again", async t3 => {
			const { connector } = base();
			connector._heartbeatInterval = 60;
			connector.startHeartbeat();
			connector.stopHeartbeat();
			t3.equal(connector._heartbeatId, null);
			connector.stopHeartbeat();
			t3.equal(connector._heartbeatId, null);
		});
	});

	t1.test("send()", async t2 => {
		t2.test("throws without a session", async t3 => {
			for (const state of ["closed", "connecting"] as const) {
				const { connector } = base(state);
				t3.throws(
					() => connector.sendEvent(new PlainEvent(), controller),
					new lib.SessionLost("No session"),
					state
				);
			}
		});
		t2.test("sends and buffers while connected", async t3 => {
			const { connector, socket } = base("connected");
			connector.sendEvent(new PlainEvent(), controller);
			const message = new lib.MessageEvent(1, control, controller, "PlainEvent");
			t3.strictSame(socket.sentJson(), [JSON.parse(JSON.stringify(message))]);
			t3.strictSame(connector._sendBuffer, [{ seq: 1, text: JSON.stringify(message), size: utf8Size(message) }]);
		});
		t2.test("only buffers while resuming", async t3 => {
			const { connector, socket } = base("resuming");
			connector.sendEvent(new PlainEvent(), controller);
			t3.strictSame(socket.sent, []);
			t3.equal(connector._sendBuffer.length, 1);
		});
		t2.test("counts buffered messages in UTF-8 bytes", async t3 => {
			// Extra bytes over the UTF-16 length for ASCII, 2 and 3 byte characters and a surrogate pair
			for (const [text, extra] of [["ascii", 0], ["é", 1], ["€", 2], ["\u{1f600}", 2]] as const) {
				const { connector } = base();
				const event = textEvent(1, text);
				connector.forward(event);
				t3.equal(connector._sendBufferSize, JSON.stringify(event).length + extra, text);
			}
		});
		t2.test("allows the limit to be reached exactly", async t3 => {
			const { connector, socket } = base();
			const close = t3.capture(connector, "close", async () => {});
			const event = textEvent(1, "€€");
			connector.maxSendBufferSize = utf8Size(event);
			connector.forward(event);
			t3.equal(connector._sendBuffer.length, 1);
			t3.equal(socket.sent.length, 1);
			t3.equal(close.calls.length, 0);
		});
		t2.test("clears the buffer and closes one byte over the limit", async t3 => {
			const { connector, socket } = base();
			const warn = t3.capture(lib.logger, "warn");
			const close = t3.capture(connector, "close", async () => {});
			const event = textEvent(1, "€€");
			connector.maxSendBufferSize = utf8Size(event) - 1;
			connector.forward(event);
			t3.equal(connector._sendBuffer.length, 0);
			t3.equal(connector._sendBufferSize, 0);
			t3.strictSame(socket.sent, []);
			t3.strictSame(close.args(), [[lib.ConnectionClosed.TryAgainLater, "Send buffer limit exceeded"]]);
			t3.strictSame(warn.args(), [[
				`Connector | closing connection to ${controller} after 1 messages were left unacknowledged`,
			]]);
		});
		t2.test("does not close again when already closing", async t3 => {
			const { connector } = base();
			t3.capture(lib.logger, "warn");
			const close = t3.capture(connector, "close", async () => {});
			connector._closing = true;
			connector.maxSendBufferSize = 1;
			connector.forward(textEvent(1, "x"));
			t3.equal(connector._sendBuffer.length, 0);
			t3.equal(close.calls.length, 0);
		});
		t2.test("logs errors from closing", async t3 => {
			const { connector } = base();
			t3.capture(lib.logger, "warn");
			const errors = t3.capture(lib.logger, "error");
			const error = new Error("Close failed");
			error.stack = "stack";
			t3.capture(connector, "close", async () => { throw error; });
			connector.maxSendBufferSize = 1;
			connector.forward(textEvent(1, "x"));
			await new Promise(resolve => { setImmediate(resolve); });
			t3.strictSame(errors.args(), [["Connector | error closing connection:\nstack"]]);
		});
	});

	t1.test("disconnect()", async t2 => {
		t2.test("closes right away when not connected", async t3 => {
			const { connector, socket } = base("resuming");
			const close = t3.capture(connector, "close", async () => {});
			await connector.disconnect();
			await connector.disconnect(4321, "Custom");
			t3.strictSame(close.args(), [[1000, "Disconnect"], [4321, "Custom"]]);
			t3.strictSame(socket.sent, []);
		});
		t2.test("sends prepare and closes once the other side is ready", async t3 => {
			const { connector, socket } = base();
			const close = t3.capture(connector, "close", async () => {});
			const done = connector.disconnect(4000, "Bye");
			t3.equal(connector._closing, true);
			t3.strictSame(socket.sentJson(), [{ type: "disconnect", data: "prepare" }]);
			t3.equal(close.calls.length, 0);
			connector.emit("disconnectReady");
			await done;
			t3.strictSame(close.args(), [[4000, "Bye"]]);
		});
		t2.test("closes if the connection closes first", async t3 => {
			const { connector } = base();
			const close = t3.capture(connector, "close", async () => {});
			const done = connector.disconnect();
			connector.emit("close");
			await done;
			t3.equal(close.calls.length, 1);
		});
		t2.test("closes after 10 seconds without an answer", async t3 => {
			const { connector } = base();
			const close = t3.capture(connector, "close", async () => {});
			const realSetTimeout = setTimeout;
			const timers = t3.capture(globalThis, "setTimeout", ((fn: () => void) => realSetTimeout(fn, 0)) as any);
			const done = connector.disconnect();
			timers.restore();
			t3.equal(timers.args()[0][1], 10000);
			await done;
			t3.equal(close.calls.length, 1);
		});
	});

	t1.test("sendDisconnectReady()", async t2 => {
		t2.test("sends disconnect ready", async t3 => {
			const { connector, socket } = base();
			connector.sendDisconnectReady();
			t3.strictSame(socket.sentJson(), [{ type: "disconnect", data: "ready" }]);
		});
	});

	t1.test("state getters", async t2 => {
		t2.test("follow the state and closing flag", async t3 => {
			const expected = {
				"closed": [false, true, false],
				"connecting": [false, false, false],
				"connected": [true, false, true],
				"resuming": [false, false, true],
			};
			for (const [state, [connected, closing, session]] of Object.entries(expected)) {
				const { connector } = base(state as State);
				t3.strictSame(
					[connector.connected, connector.closing, connector.hasSession, connector.valid],
					[connected, closing, session, session],
					state
				);
				connector._closing = true;
				t3.strictSame([connector.connected, connector.closing], [false, true], `${state} closing`);
			}
		});
	});

	t1.test("_reset()", async t2 => {
		t2.test("returns to the closed state", async t3 => {
			const { connector } = base("connected");
			connector._socket = null;
			connector._closing = true;
			connector._heartbeatInterval = 10;
			connector._lastHeartbeatMs = 5;
			connector._lastReceivedSeq = 3 as any;
			connector._sendBuffer.push({ seq: 1, text: "a", size: 1 });
			connector._sendBufferSize = 1;
			const seen = emitted(connector, "reset");
			connector._reset();
			t3.equal(connector._state, "closed");
			t3.equal(connector._closing, false);
			t3.equal(connector._heartbeatInterval, null);
			t3.equal(connector._lastHeartbeatMs, null);
			t3.equal(connector._lastReceivedSeq, undefined);
			t3.strictSame(connector._sendBuffer, []);
			t3.equal(connector._sendBufferSize, 0);
			t3.strictSame(seen, [["reset"]]);
		});
		t2.test("asserts the socket is gone", async t3 => {
			const { connector } = base("connected");
			t3.throws(() => connector._reset(), new Error("Assertion failed"));
		});
	});

	t1.test("_invalidate()", async t2 => {
		t2.test("goes back to connecting and forgets the session", async t3 => {
			const { connector } = base("resuming");
			connector._lastReceivedSeq = 3 as any;
			connector._sendBuffer.push({ seq: 1, text: "a", size: 1 });
			connector._sendBufferSize = 1;
			const seen = emitted(connector, "invalidate");
			connector._invalidate();
			t3.equal(connector._state, "connecting");
			t3.equal(connector._lastReceivedSeq, undefined);
			t3.strictSame(connector._sendBuffer, []);
			t3.equal(connector._sendBufferSize, 0);
			t3.strictSame(seen, [["invalidate"]]);
		});
	});
});

t.test("WebSocketClientConnector", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("targets the controller", async t3 => {
			const connector = new TestClientConnector("http://localhost/", 7);
			t3.equal(connector.src, undefined);
			t3.strictSame(connector.dst, controller);
			t3.equal(connector._backoff.max, 7);
			t3.equal(connector._state, "closed");
		});
	});

	t1.test("sendHandshake()", async t2 => {
		t2.test("sends while connecting or resuming", async t3 => {
			for (const state of ["connecting", "resuming"] as const) {
				const { connector, socket } = client(state);
				connector.sendHandshake(new lib.MessageInvalidate());
				t3.strictSame(socket.sentJson(), [{ type: "invalidate" }], state);
			}
		});
		t2.test("throws once connected", async t3 => {
			const { connector } = client("connected");
			t3.throws(
				() => connector.sendHandshake(new lib.MessageInvalidate()),
				new Error("Expected state connecting,resuming but state is connected")
			);
		});
	});

	t1.test("close()", async t2 => {
		t2.test("does nothing when closed", async t3 => {
			const { connector, socket } = client("closed");
			await connector.close(1000, "Done");
			t3.strictSame(socket.closed, []);
			t3.equal(connector._closing, false);
		});
		t2.test("closes the socket and waits for it", async t3 => {
			const { connector, socket } = client("connected");
			t3.capture(lib.logger, "verbose");
			const seen = emitted(connector, "close");
			const done = connector.close(4000, "Done");
			t3.equal(connector._closing, true);
			t3.strictSame(socket.closed, [[4000, "Done"]]);
			socket.onclose({ code: 4000, reason: "Done" });
			await done;
			t3.equal(connector._state, "closed");
			t3.equal(connector._socket, null);
			t3.strictSame(seen, [["close"]]);
		});
		t2.test("closes right away while waiting to reconnect", async t3 => {
			const { connector } = client("resuming");
			connector._socket = null;
			connector._reconnectId = setTimeout(() => { t3.fail("reconnected"); }, 1000);
			const seen = emitted(connector, "close");
			await connector.close(1000, "Done");
			t3.equal(connector._state, "closed");
			t3.equal(connector._reconnectId, undefined);
			t3.strictSame(seen, [["close"]]);
		});
	});

	t1.test("setClosing()", async t2 => {
		t2.test("does nothing when closed", async t3 => {
			const { connector } = client("closed");
			connector.setClosing();
			t3.equal(connector._closing, false);
		});
		t2.test("only sets the flag when connected", async t3 => {
			const { connector, socket } = client("connected");
			connector.setClosing();
			t3.equal(connector._closing, true);
			t3.strictSame(socket.closed, []);
		});
		t2.test("closes the socket while connecting", async t3 => {
			const { connector, socket } = client("connecting");
			connector.setClosing();
			t3.strictSame(socket.closed, [[lib.ConnectionClosed.NormalClosure, "Connector closing"]]);
		});
		t2.test("closes right away without a socket", async t3 => {
			const { connector } = client("resuming");
			connector._socket = null;
			const seen = emitted(connector, "close");
			connector.setClosing();
			t3.equal(connector._state, "closed");
			t3.strictSame(seen, [["close"]]);
		});
	});

	t1.test("connect()", async t2 => {
		t2.test("throws unless closed", async t3 => {
			const { connector } = client("connected");
			await t3.rejects(connector.connect(), new Error("Expected state closed but state is connected"));
		});
		t2.test("connects to the api/socket path and completes the handshake", async t3 => {
			const server = await wsServer(t3, [JSON.stringify(hello()), JSON.stringify(ready(600))]);
			const connector = new TestClientConnector(server.url, 1);
			t3.capture(lib.logger, "verbose");
			const seen = emitted(connector, "hello");
			await connector.connect();
			t3.strictSame(server.urls, ["/api/socket"]);
			t3.equal(connector.registered, 1);
			t3.equal(seen.length, 1);
			t3.equal(connector.connected, true);
			t3.strictSame(connector.src, control);
			await connector.close(1000, "Done");
			t3.equal(connector._state, "closed");
		});
		t2.test("schedules a reconnect when the server refuses", async t3 => {
			const server = await wsServer(t3, []);
			const connector = new TestClientConnector(`${server.url}refuse/`, 1);
			const verbose = t3.capture(lib.logger, "verbose");
			const reconnecting = new Promise<void>(resolve => {
				t3.capture(connector, "reconnect", () => { resolve(); });
			});
			connector.connect().catch(() => {});
			await reconnecting;
			t3.equal(connector._socket, null);
			t3.equal(connector._state, "connecting");
			const messages = verbose.args().map(args => args[0]);
			const port = new URL(server.url).port;
			t3.ok(messages.includes(`Connector | connecting to ws://127.0.0.1:${port}/refuse/api/socket`));
			t3.ok(messages.some(message => message.startsWith("Connector | Socket error: ")));
			connector.setClosing();
			t3.equal(connector._state, "closed");
		});
	});

	t1.test("reconnect()", async t2 => {
		t2.test("throws while the socket is open", async t3 => {
			const { connector } = client("connecting");
			t3.throws(() => connector.reconnect(), new Error("Cannot reconnect while socket is open"));
		});
		t2.test("connects again after the backoff delay", async t3 => {
			const { connector } = client("connecting");
			connector._socket = null;
			t3.capture(lib.logger, "verbose");
			t3.capture(connector._backoff, "delay", () => 1);
			const connected = new Promise<void>(resolve => {
				t3.capture(connector, "_doConnect", () => { resolve(); });
			});
			connector.reconnect();
			t3.not(connector._reconnectId, undefined);
			await connected;
			t3.equal(connector._reconnectId, undefined);
		});
		t2.test("logs an unexpected second call", async t3 => {
			const { connector } = client("connecting");
			connector._socket = null;
			t3.capture(lib.logger, "verbose");
			const errors = t3.capture(lib.logger, "error");
			t3.capture(connector._backoff, "delay", () => 60000);
			connector.reconnect();
			const first = connector._reconnectId;
			connector.reconnect();
			clearTimeout(first);
			clearTimeout(connector._reconnectId);
			t3.strictSame(errors.args(), [["Unexpected double call to reconnect"]]);
		});
		t2.test("invalidates the session once it can no longer resume", async t3 => {
			const { connector } = client("resuming");
			connector._socket = null;
			connector._sessionToken = "token";
			connector._sessionTimeout = 10;
			connector._startedResumingMs = Date.now() - 9000;
			t3.capture(lib.logger, "verbose");
			const errors = t3.capture(lib.logger, "error");
			t3.capture(connector._backoff, "delay", () => 2000);
			const seen = emitted(connector, "invalidate");
			connector.reconnect();
			t3.strictSame(errors.args(), [["Connector | Session timed out trying to resume"]]);
			t3.equal(connector._state, "connecting");
			t3.equal(connector._sessionToken, null);
			t3.strictSame(seen, [["invalidate"]]);
			t3.not(connector._reconnectId, undefined);
			clearTimeout(connector._reconnectId);
		});
		t2.test("keeps resuming while the session is still valid", async t3 => {
			const { connector } = client("resuming");
			connector._socket = null;
			connector._sessionToken = "token";
			connector._sessionTimeout = 120;
			connector._startedResumingMs = Date.now();
			t3.capture(lib.logger, "verbose");
			t3.capture(connector._backoff, "delay", () => 60000);
			connector.reconnect();
			clearTimeout(connector._reconnectId);
			t3.equal(connector._state, "resuming");
			t3.equal(connector._sessionToken, "token");
		});
		t2.test("stays closed when the session times out while closing", async t3 => {
			const { connector } = client("resuming");
			connector._socket = null;
			connector._closing = true;
			connector._sessionTimeout = 10;
			connector._startedResumingMs = Date.now() - 20000;
			t3.capture(lib.logger, "verbose");
			t3.capture(lib.logger, "error");
			t3.capture(connector._backoff, "delay", () => 60000);
			const seen = emitted(connector, "close");
			connector.reconnect();
			t3.equal(connector._state, "closed");
			t3.strictSame(seen, [["close"]]);
			t3.equal(connector._reconnectId, undefined);
			clearTimeout(connector._reconnectId);
		});
	});

	t1.test("socket close", async t2 => {
		for (const [code, ErrorClass] of [
			[lib.ConnectionClosed.Unauthorized, lib.AuthenticationFailed],
			[lib.ConnectionClosed.ProtocolError, lib.ProtocolError],
			[lib.ConnectionClosed.PolicyViolation, lib.PolicyViolation],
		] as const) {
			t2.test(`emits ${ErrorClass.name} and closes on code ${code}`, async t3 => {
				const { connector } = client("connecting");
				t3.capture(lib.logger, "verbose");
				const seen = emitted(connector, "error", "close");
				connector._socket!.onclose!({ code, reason: "Why" } as any);
				t3.strictSame(seen, [["error", new ErrorClass("Why")], ["close"]]);
				t3.equal(connector._state, "closed");
			});
		}
		t2.test("closes when connected and closing", async t3 => {
			const { connector, socket } = client("connected");
			connector._closing = true;
			connector._heartbeatInterval = 60;
			connector.startHeartbeat();
			const verbose = t3.capture(lib.logger, "verbose");
			const seen = emitted(connector, "close", "drop");
			socket.onclose({ code: 1000, reason: "Bye" });
			t3.equal(connector._heartbeatId, null);
			t3.equal(connector._state, "closed");
			t3.strictSame(seen, [["close"]]);
			t3.strictSame(verbose.args(), [["Connector | Close (code: 1000, reason: Bye)"]]);
		});
		t2.test("starts resuming when the connection drops", async t3 => {
			const { connector, socket } = client("connected");
			t3.capture(Date, "now", () => 777);
			const info = t3.capture(lib.logger, "info");
			const reconnect = t3.capture(connector, "reconnect");
			const seen = emitted(connector, "close", "drop");
			socket.onclose({ code: 1006, reason: "" });
			t3.equal(connector._state, "resuming");
			t3.equal(connector._startedResumingMs, 777);
			t3.equal(reconnect.calls.length, 1);
			t3.strictSame(seen, [["drop"]]);
			t3.strictSame(info.args(), [["Connector | Close (code: 1006, reason: )"]]);
		});
		t2.test("reconnects when not connected yet", async t3 => {
			const { connector, socket } = client("connecting");
			const verbose = t3.capture(lib.logger, "verbose");
			const reconnect = t3.capture(connector, "reconnect");
			socket.onclose({ code: 1006, reason: "" });
			t3.equal(connector._state, "connecting");
			t3.equal(reconnect.calls.length, 1);
			t3.strictSame(verbose.args(), [["Connector | Close (code: 1006, reason: )"]]);
		});
	});

	t1.test("socket error", async t2 => {
		t2.test("logs as error when connected", async t3 => {
			const { connector, socket } = client("connected");
			const errors = t3.capture(lib.logger, "error");
			socket.onerror({ message: "Broken", error: { code: "ECONNRESET" } });
			t3.strictSame(errors.args(), [["Connector | Socket error: Broken, code: ECONNRESET"]]);
			t3.equal(connector._closing, false);
		});
		t2.test("logs as verbose when not connected", async t3 => {
			const { socket } = client("connecting");
			const verbose = t3.capture(lib.logger, "verbose");
			socket.onerror({});
			t3.strictSame(verbose.args(), [["Connector | Socket error: unknown error"]]);
		});
		t2.test("aborts on certificate errors", async t3 => {
			for (const code of ["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID"]) {
				const { connector, socket } = client("connecting");
				t3.capture(lib.logger, "verbose");
				const seen = emitted(connector, "error");
				socket.onerror({ message: "Cert", error: { code, message: "Bad cert" } });
				t3.strictSame(seen, [["error", new lib.AuthenticationFailed("Bad cert")]], code);
				t3.equal(connector._closing, true, code);
			}
		});
	});

	t1.test("socket open", async t2 => {
		t2.test("logs", async t3 => {
			const { socket } = client("connecting");
			const verbose = t3.capture(lib.logger, "verbose");
			socket.onopen();
			t3.strictSame(verbose.args(), [["Connector | Open"]]);
		});
	});

	t1.test("socket message", async t2 => {
		t2.test("ignores malformed messages", async t3 => {
			const { connector, socket } = client("connecting");
			const handshake = t3.capture(connector, "_processHandshake");
			socket.onmessage({ data: "{" });
			t3.equal(handshake.calls.length, 0);
			t3.strictSame(socket.closed, [[lib.ConnectionClosed.MalformedMessage, "Malformed JSON"]]);
		});
		t2.test("handles the handshake while connecting or resuming", async t3 => {
			for (const state of ["connecting", "resuming"] as const) {
				const { connector, socket } = client(state);
				const handshake = t3.capture(connector, "_processHandshake");
				socket.onmessage({ data: JSON.stringify(new lib.MessageInvalidate()) });
				t3.strictSame(handshake.args(), [[new lib.MessageInvalidate()]], state);
			}
		});
		t2.test("emits messages when connected", async t3 => {
			const { connector, socket } = client("connected");
			const seen = emitted(connector, "message");
			const event = textEvent(1, "x");
			socket.onmessage({ data: JSON.stringify(event) });
			t3.strictSame(seen, [["message", event]]);
		});
		t2.test("throws when closed", async t3 => {
			const { socket } = client("closed");
			t3.throws(
				() => socket.onmessage({ data: JSON.stringify(new lib.MessageInvalidate()) }),
				new Error("Received message in unexpected state closed")
			);
		});
	});

	t1.test("_processHandshake()", async t2 => {
		t2.test("registers on hello without a session", async t3 => {
			const { connector, socket } = client("connecting");
			t3.capture(lib.logger, "verbose");
			const seen = emitted(connector, "hello");
			const message = hello();
			connector._processHandshake(message);
			t3.equal(connector.registered, 1);
			t3.strictSame(seen, [["hello", message.data]]);
			t3.strictSame(socket.sent, []);
		});
		t2.test("resumes on hello with a session", async t3 => {
			const { connector, socket } = client("resuming");
			t3.capture(lib.logger, "verbose");
			connector._sessionToken = "token";
			connector._lastReceivedSeq = 8 as any;
			connector._processHandshake(hello());
			t3.equal(connector.registered, 0);
			t3.strictSame(socket.sentJson(), [{ type: "resume", data: { sessionToken: "token", lastSeq: 8 } }]);
		});
		t2.test("becomes connected on ready and sends buffered messages", async t3 => {
			const { connector, socket } = client("connecting");
			t3.capture(lib.logger, "verbose");
			t3.teardown(() => connector.stopHeartbeat());
			connector._sendBuffer.push({ seq: 1, text: "buffered", size: 8 });
			const seen = emitted(connector, "connect");
			const message = ready(15);
			connector._processHandshake(message);
			t3.equal(connector._state, "connected");
			t3.strictSame(connector.src, control);
			t3.equal(connector._sessionToken, "token");
			t3.equal(connector._sessionTimeout, 60);
			t3.equal(connector._heartbeatInterval, 15);
			t3.not(connector._heartbeatId, null);
			t3.strictSame(socket.sent, ["buffered"]);
			t3.strictSame(seen, [["connect", message.data]]);
		});
		t2.test("resumes on continue and resends unacknowledged messages", async t3 => {
			const { connector, socket } = client("resuming");
			const info = t3.capture(lib.logger, "info");
			t3.teardown(() => connector.stopHeartbeat());
			connector._startedResumingMs = 100;
			connector._sendBuffer.push({ seq: 1, text: "one", size: 3 }, { seq: 2, text: "two", size: 3 });
			connector._sendBufferSize = 6;
			const seen = emitted(connector, "resume");
			connector._processHandshake(new lib.MessageContinue(new lib.ContinueData(30, 5, 1)));
			t3.equal(connector._state, "connected");
			t3.equal(connector._sessionTimeout, 30);
			t3.equal(connector._heartbeatInterval, 5);
			t3.not(connector._heartbeatId, null);
			t3.equal(connector._startedResumingMs, null);
			t3.strictSame(socket.sent, ["two"]);
			t3.equal(connector._sendBufferSize, 3);
			t3.strictSame(seen, [["resume"]]);
			t3.strictSame(info.args(), [["Connector | resuming existing session, resending 1 buffered messages"]]);
		});
		t2.test("registers again on invalidate", async t3 => {
			const { connector } = client("resuming");
			t3.capture(lib.logger, "warn");
			connector._sessionToken = "token";
			const seen = emitted(connector, "invalidate", "close");
			connector._processHandshake(new lib.MessageInvalidate());
			t3.equal(connector._state, "connecting");
			t3.equal(connector._sessionToken, null);
			t3.equal(connector.registered, 1);
			t3.strictSame(seen, [["invalidate"]]);
		});
		t2.test("closes on invalidate while closing", async t3 => {
			const { connector } = client("resuming");
			connector._socket = null;
			connector._closing = true;
			t3.capture(lib.logger, "warn");
			const seen = emitted(connector, "invalidate", "close");
			connector._processHandshake(new lib.MessageInvalidate());
			t3.equal(connector._state, "closed");
			t3.equal(connector.registered, 0);
			t3.strictSame(seen, [["close"]]);
		});
		t2.test("ignores other messages", async t3 => {
			const { connector, socket } = client("connecting");
			connector._processHandshake(new lib.MessageHeartbeat(1));
			t3.equal(connector._state, "connecting");
			t3.equal(connector.registered, 0);
			t3.strictSame(socket.sent, []);
		});
	});
});
