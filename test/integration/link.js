"use strict";
const assert = require("assert").strict;
const events = require("events");
const fs = require("fs-extra");
const jwt = require("jsonwebtoken");

const { TestControlConnector, TestControl, get, exec, url } = require("./index");

let token = jwt.sign({ aud: "user", user: "test" }, "TestSecretDoNotUse");

describe("Integration of lib/link", function() {
	let tlsCa;
	let control;
	let controlConnector;
	before(async function() {
		tlsCa = await fs.readFile("test/file/tls/cert.pem");
	});
	it("should emitt an error if authentication failed", async function() {
		controlConnector = new TestControlConnector(url, 0.2, tlsCa);
		controlConnector.token = "gibberish";
		control = new TestControl(controlConnector);
		await assert.rejects(
			controlConnector.connect(),
			new Error("Authentication failed: jwt malformed")
		);
	});

	it("should connect with proper credentials", async function() {
		controlConnector = new TestControlConnector(url, 0.2, tlsCa);
		controlConnector.token = token;
		control = new TestControl(controlConnector);
		await controlConnector.connect();
	});

	it("should reconnect on connection lost", async function() {
		controlConnector._socket.close(1008, "Test");
		await events.once(controlConnector, "resume");
	});

	it("should reconnect on connection terminated", async function() {
		controlConnector._socket.terminate();
		await events.once(controlConnector, "resume");
	});

	it("should reconnect on connection heartbeat timeout", async function() {
		controlConnector.stopHeartbeat();
		await events.once(controlConnector, "resume");
	});

	it("should invalidate on reconnection with bad session token", async function() {
		controlConnector._sessionToken = "blah";
		controlConnector.stopHeartbeat();
		await events.once(controlConnector, "invalidate");
		await events.once(controlConnector, "connect");
	});

	it("should properly close connector if close is called during reconnect wait", async function() {
		controlConnector._socket.close(1008, "Test");
		controlConnector.once("drop", () => {
			controlConnector.close();
		});
		await events.once(controlConnector, "close");
	});
});
