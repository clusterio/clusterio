"use strict";
const assert = require("assert").strict;
const events = require("events");
const fs = require("fs-extra");
const jwt = require("jsonwebtoken");

const { TestControlConnector, TestHostConnector, TestControl, get, exec, url, slowTest } = require("./index");
const { ConnectionClosed, ProtocolError, PolicyViolation, AuthenticationFailed } = require("@clusterio/lib");

let token = jwt.sign({ aud: "user", user: "test" }, Buffer.from("TestSecretDoNotUse", "base64"));
let tokenHost = jwt.sign({ aud: "host", host: 0 }, Buffer.from("TestSecretDoNotUse", "base64"));

describe("Integration of lib/link", function() {
	let tlsCa;
	let control;
	let controlConnector;
	let hostConnector;
	before(async function() {
		tlsCa = await fs.readFile("test/file/tls/cert.pem");
	});
	beforeEach(async function() {
		controlConnector = new TestControlConnector(url, 0.2, tlsCa);
		controlConnector.token = token;
		control = new TestControl(controlConnector, false);
		hostConnector = new TestHostConnector(url, 0.2, tlsCa);
		hostConnector.token = tokenHost;
		hostConnector.hostId = 0;
	});
	afterEach(async function() {
		await controlConnector.disconnect();
		await hostConnector.disconnect();
	});

	it("should emitt an error if authentication failed", async function() {
		controlConnector.token = "gibberish";
		await assert.rejects(
			controlConnector.connect(),
			new Error("Authentication failed: jwt malformed")
		);
	});

	it("should connect with proper credentials", async function() {
		await controlConnector.connect();
	});
	it("should emit an error if closed due to ProtocolError", async function() {
		await controlConnector.connect();
		controlConnector._socket.close(ConnectionClosed.ProtocolError, "Test");
		await assert.rejects(
			// event.once rejects if "error" is emitted before "close"
			events.once(controlConnector, "close"),
			new ProtocolError("Test")
		);
	});
	it("should emit an error if closed due to PolicyError", async function() {
		await controlConnector.connect();
		controlConnector._socket.close(ConnectionClosed.PolicyViolation, "Test");
		await assert.rejects(
			// event.once rejects if "error" is emitted before "close"
			events.once(controlConnector, "close"),
			new PolicyViolation("Test")
		);
	});
	it("should emit an error if closed due to Unauthorized", async function() {
		await controlConnector.connect();
		controlConnector._socket.close(ConnectionClosed.Unauthorized, "Test");
		await assert.rejects(
			// event.once rejects if "error" is emitted before "close"
			events.once(controlConnector, "close"),
			new AuthenticationFailed("Test")
		);
	});

	it("should reconnect on connection lost", async function() {
		await controlConnector.connect();
		controlConnector._socket.close(ConnectionClosed.Normal, "Test");
		await events.once(controlConnector, "resume");
	});

	it("should reconnect on connection terminated", async function() {
		await controlConnector.connect();
		controlConnector._socket.terminate();
		await events.once(controlConnector, "resume");
	});

	it("should reconnect on connection heartbeat timeout", async function() {
		await controlConnector.connect();
		controlConnector.stopHeartbeat();
		await events.once(controlConnector, "resume");
	});

	it("should invalidate on reconnection with bad session token", async function() {
		await controlConnector.connect();
		controlConnector._sessionToken = "blah";
		controlConnector.stopHeartbeat();
		await events.once(controlConnector, "invalidate");
		await events.once(controlConnector, "connect");
	});

	it("should properly close connector if close is called during reconnect wait", async function() {
		await controlConnector.connect();
		controlConnector._socket.close(ConnectionClosed.Normal, "Test");
		controlConnector.once("drop", () => {
			controlConnector.close();
		});
		await events.once(controlConnector, "close");
	});

	it("should refuse connection with incorrect audience", async function() {
		hostConnector.token = token;
		await assert.rejects(
			hostConnector.connect(),
			new Error("Authentication failed: jwt audience invalid. expected: host or slave")
		);
	});

	it("should refuse connection with mismatched ids", async function() {
		hostConnector.hostId = 1;
		await assert.rejects(
			hostConnector.connect(),
			new Error("Authentication failed: missmatched host id")
		);
	});

	it("should close old connections from the same address", async function() {
		slowTest(this);
		const hostConnectorFirst = new TestHostConnector(url, 0.2, tlsCa);
		hostConnectorFirst.token = hostConnector.token;
		hostConnectorFirst.hostId = hostConnector.hostId;
		const onceClose = events.once(hostConnectorFirst, "close");
		onceClose.catch(() => {}); // Prevent unhandled promise rejection.
		await hostConnectorFirst.connect();
		await hostConnector.connect();
		await assert.rejects(
			onceClose,
			new PolicyViolation("Newer connection for host from same address")
		);
	});

	it("should refuse duplicate host connections", async function() {
		this.skip(); // Can't be checked because the remote address for both connections is the same

		hostConnector.token = jwt.sign({ aud: "host", host: 4 }, Buffer.from("TestSecretDoNotUse", "base64"));
		hostConnector.hostId = 4; // Same as already running host
		await assert.rejects(
			hostConnector.connect(),
			new Error("Authentication failed: missmatched host id")
		);
	});
});
