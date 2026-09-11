"use strict";
const { JsonBoolean, JsonString } = require("@clusterio/lib");

// Sent from ctl to the controller, which answers with the text it was given
// and broadcasts a HostEcho to the hosts.
class ControllerEcho {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static plugin = "test_plugin";
	static permission = null;
	static Response = JsonString;

	constructor(text) {
		this.text = text;
	}

	static jsonSchema = { type: "string" };
	toJSON() { return this.text; }
	static fromJSON(json) { return new this(json); }
}

// Broadcast from the controller to the hosts by broadcastEventToHosts.
class HostEcho {
	static type = "event";
	static src = "controller";
	static dst = "host";
	static plugin = "test_plugin";
	static permission = null;

	constructor(text) {
		this.text = text;
	}

	static jsonSchema = { type: "string" };
	toJSON() { return this.text; }
	static fromJSON(json) { return new this(json); }
}

// Sent from ctl to a host, which answers with whether it received the given
// text via a HostEcho.
class HostEchoReceived {
	static type = "request";
	static src = "control";
	static dst = "host";
	static plugin = "test_plugin";
	static permission = null;
	static Response = JsonBoolean;

	constructor(text) {
		this.text = text;
	}

	static jsonSchema = { type: "string" };
	toJSON() { return this.text; }
	static fromJSON(json) { return new this(json); }
}

module.exports = {
	ControllerEcho,
	HostEcho,
	HostEchoReceived,
};
