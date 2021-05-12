"use strict";
const events = require("events");
const http = require("http");
const express = require("express");

const libLink = require("@clusterio/lib/link");
const libPlugin = require("@clusterio/lib/plugin");
const libUsers = require("@clusterio/lib/users");
const libPrometheus = require("@clusterio/lib/prometheus");

const UserManager = require("@clusterio/master/src/UserManager");


class MockLogger {
	child() { return this; }

	fatal() { }

	error() { }

	warn() { }

	audit() { }

	info() { }

	server() { }

	verbose() { }
}

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

class MockServer extends events.EventEmitter {
	constructor() {
		super();
		this.reset();
	}

	reset() {
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
		this.logger = new MockLogger();
		this.server = new MockServer();
		this.name = "test";
		this.id = 7357;
		this.mockConfigEntries = new Map([
			["instance.id", 7357],
			["factorio.enable_save_patching", true],
		]);
		this.config = {
			get: (name) => {
				if (this.mockConfigEntries.has(name)) {
					return this.mockConfigEntries.get(name);
				}
				throw Error(`mock for field ${name} is not implemented`);
			},
		};
	}

	async sendRcon(command, expectEmpty, plugin) {
		return await this.server.sendRcon(command);
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

class MockMaster {
	constructor() {
		this.app = express();
		this.mockConfigEntries = new Map([
			["master.external_address", "test"],
			["master.auth_secret", "TestSecretDoNotUse"],
		]);
		this.config = {
			get: (name) => {
				if (this.mockConfigEntries.has(name)) {
					return this.mockConfigEntries.get(name);
				}
				throw Error(`mock for field ${name} is not implemented`);
			},
		};

		this.userManager = new UserManager();
		this.userManager.roles = new Map([
			[0, new libUsers.Role({ id: 0, name: "Admin", description: "admin", permissions: ["core.admin"] })],
			[1, new libUsers.Role({ id: 1, name: "Player", description: "player", permissions: [] })],
		]);
		this.userManager.roles.get(1).grantDefaultPermissions();

		this.userManager.users = new Map([
			["test", new libUsers.User({ name: "test", roles: [0, 1] }, this.userManager.roles)],
			["player", new libUsers.User({ name: "player", roles: [1] }, this.userManager.roles)],
		]);
		this.instances = new Map();
		this.slaves = new Map();
	}

	getMasterUrl() {
		return "http://master.example/";
	}

	async startServer() {
		this.server = http.createServer(this.app);
		await new Promise(resolve => {
			this.server.listen(0, "127.0.0.1", resolve);
		});
		let address = this.server.address();
		return `http://127.0.0.1:${address.port}`;
	}

	async stopServer() {
		if (this.server) {
			this.server.close();
			this.server.unref();
		}
	}
}

async function createMasterPlugin(MasterPluginClass, info) {
	let master = new MockMaster();
	let metrics = {
		endpointHitCounter: new libPrometheus.Counter("hit_counter", "Hit Counter", { labels: ["route"] }),
	};
	let logger = new MockLogger();
	let plugin = new MasterPluginClass(info, master, metrics, logger);
	await plugin.init();
	return plugin;
}

async function createInstancePlugin(InstancePluginClass, info) {
	let instance = new MockInstance();
	let slave = new MockSlave();
	let plugin = new InstancePluginClass(info, instance, slave);
	libPlugin.attachPluginMessages(instance, plugin);
	await plugin.init();
	return plugin;
}


module.exports = {
	MockLogger,
	MockSocket,
	MockConnector,
	MockInstance,
	MockSlave,
	MockControl,

	createMasterPlugin,
	createInstancePlugin,
};
