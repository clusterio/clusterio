"use strict";
const assert = require("assert").strict;
const events = require("events");
const fs = require("fs-extra");
const jwt = require("jsonwebtoken");

const { TestControlConnector, TestControl, get, exec, url } = require("./index");
const { ConnectionClosed, ProtocolViolation, PolicyViolation, AuthenticationFailed } = require("@clusterio/lib");

let token = jwt.sign({ aud: "user", user: "test" }, Buffer.from("TestSecretDoNotUse", "base64"));

describe("Integration of lib/link", function() {
	let tlsCa;
	let control;
	let controlConnector;
	before(async function() {
		tlsCa = await fs.readFile("test/file/tls/cert.pem");
	});
	beforeEach(async function() {
		controlConnector = new TestControlConnector(url, 0.2, tlsCa);
		controlConnector.token = token;
		control = new TestControl(controlConnector, false);
	});
	afterEach(async function() {
		await controlConnector.disconnect();
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
			new ProtocolViolation("Test")
		);
	});
	it("should emit an error if closed due to PolicyError", async function() {
		await controlConnector.connect();
		controlConnector._socket.close(ConnectionClosed.PolicyError, "Test");
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
});
