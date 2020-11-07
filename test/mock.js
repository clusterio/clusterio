"use strict";
const events = require("events");

const libLink = require("@clusterio/lib/link");


class MockSocket {
	constructor() {
		this.sentMessages = [];
		this.events = new Map();
	}

	send(message) {
		this.sentMessages.push(message);
	}

	on(event, fn) {
		this.events.set(event, fn);
	}

	/* eslint-disable accessor-pairs */
	set onclose(fn) {
		this.on("close", (code, reason) => fn({ code, reason }));
	}

	set onerror(fn) {
		this.on("error", fn);
	}

	set onopen(fn) {
		this.on("open", fn);
	}

	set onmessage(fn) {
		this.on("message", (data) => fn({ data }));
	}

	terminate() {
		this.terminateCalled = true;
	}

	close() {
		this.closeCalled = true;
	}
}

class MockConnector extends events.EventEmitter {
	constructor() {
		super();

		this._seq = 1;
		this.sentMessages = [];
		this.events = new Map();
		this.handshake = { address: "socket.test" };

		this.connected = true;
		this.closing = false;
	}

	send(type, data) {
		let seq = this._seq;
		this._seq += 1;
		let message = { seq, type, data };
		this.sentMessages.push(message);
		setImmediate(() => this.emit("send", message));
		return seq;
	}
}

class MockServer {
	constructor() {
		this.rconCommands = [];
		this.rconCommandResults = new Map();
	}

	async sendRcon(command) {
		this.rconCommands.push(command);
		return this.rconCommandResults.get(command) || "";
	}
}

class MockInstance extends libLink.Link {
	constructor() {
		super("instance", "slave", new MockConnector());
		this.server = new MockServer();
		this.name = "test";
		this.config = {
			get: (name) => {
				if (name === "instance.id") { return 7357; }
				if (name === "factorio.enable_save_patching") { return true; }
				throw Error("Not implemented");
			},
		};
	}
}

class MockSlave extends libLink.Link {
	constructor() {
		super("slave", "master", new MockConnector());
	}
}

class MockControl extends libLink.Link {
	constructor(connector) {
		super("control", "master", connector);
	}
}


module.exports = {
	MockSocket,
	MockConnector,
	MockInstance,
	MockSlave,
	MockControl,
};
