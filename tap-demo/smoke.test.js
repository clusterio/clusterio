"use strict";
// A trunk-style tap smoke test: runs in its own subprocess and talks to the controller
// that --before booted once. Proves tap can host clusterio's shared-cluster model.
// Needs NO Factorio install — only the controller + the control link layer.
const tap = require("tap");
const jwt = require("jsonwebtoken");
const lib = require("@clusterio/lib");
const { authSecret, controllerUrl } = require("./shared");

class DemoControlConnector extends lib.WebSocketClientConnector {
	register() {
		this.sendHandshake(new lib.MessageRegisterControl(new lib.RegisterControlData(this.token, "tap-demo")));
	}
}

// connect() retries forever on an unreachable controller, so bound it: reject with a clear
// message instead of hanging until tap's generic timeout.
function withTimeout(promise, ms, message) {
	let timer;
	const timeout = new Promise((resolve, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

tap.test("a tap test connects to the controller booted once by --before", async t => {
	const token = jwt.sign({ aud: "user", user: "test" }, Buffer.from(authSecret, "base64"));
	const connector = new DemoControlConnector(controllerUrl, 2);
	connector.token = token;
	const control = new lib.Link(connector);

	// An 'error' emitted on the connector with no listener would crash the whole runner;
	// capture it so a mid-session failure fails this test instead.
	const errors = [];
	connector.on("error", err => errors.push(err));
	t.teardown(() => connector.close(1000, "test done"));

	await withTimeout(connector.connect(), 20000, "control link did not connect within 20s");
	t.pass("control link established a session with the shared controller");

	const hosts = await control.sendTo("controller", new lib.HostListRequest());
	t.same(hosts, [], "HostListRequest routed through the controller and returned the (empty) host list");
	t.same(errors, [], "no errors were emitted on the control connector during the session");
});
