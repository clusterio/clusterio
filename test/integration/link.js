const assert = require("assert").strict;
const events = require("events");

const { TestControlConnector, TestControl, get, exec, url, token } = require("./index");


describe("Integration of lib/link", function() {
	let control;
	let controlConnector;
	it("should emitt an error if authentication failed", async function() {
		controlConnector = new TestControlConnector(url, 0.2);
		controlConnector.token = "gibberish";
		control = new TestControl(controlConnector);
		await assert.rejects(
			controlConnector.connect(),
			new Error("Authentication failed")
		);
	});

	it("should connect with proper credentials", async function() {
		controlConnector = new TestControlConnector(url, 0.2);
		controlConnector.token = token;
		control = new TestControl(controlConnector);
		await controlConnector.connect();
	});

	it("should reconnect on connection lost", async function() {
		controlConnector._socket.close(1008, "Test");
		await events.once(controlConnector, "connect");
	});

	it("should reconnect on connection terminated", async function() {
		controlConnector._socket.terminate();
		await events.once(controlConnector, "connect");
	});

	it("should reconnect on connection heartbeat timeout", async function() {
		controlConnector.stopHeartbeat();
		await events.once(controlConnector, "connect");
	});

	it("should invalidate on reconnection with bad session token", async function() {
		controlConnector._sessionToken = "blah";
		controlConnector.stopHeartbeat();
		await events.once(controlConnector, "invalidate");
		await events.once(controlConnector, "connect");
	});
});
