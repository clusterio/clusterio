"use strict";
const events = require("events");
const http = require("http");
const express = require("express");

const libData = require("@clusterio/lib/data");
const libHelpers = require("@clusterio/lib/helpers");
const libLink = require("@clusterio/lib/link");
const libPlugin = require("@clusterio/lib/plugin");
const libUsers = require("@clusterio/lib/users");
const libPrometheus = require("@clusterio/lib/prometheus");

const UserManager = require("@clusterio/controller/src/UserManager");

const addr = libData.Address.fromShorthand;

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

class MockConnector extends libLink.BaseConnector {
	constructor(src, dst) {
		super(src, dst);

		this.connected = true;
		this.sentMessages = [];
	}

	send(message) {
		this.sentMessages.push(message);
		setImmediate(() => this.emit("send", message));
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
		let result = this.rconCommandResults.get(command);
		if (!result) {
			result = { response: "" };
		}
		if (result instanceof Error || typeof result === "string") {
			result = { response: result };
		}
		if (result.time) {
			await libHelpers.wait(result.time);
		}
		if (result.response instanceof Error) {
			throw result.response;
		}
		return result.response || "";
	}
}

class MockInstance extends libLink.Link {
	constructor() {
		super(new MockConnector(addr({ instanceId: 7357 }), addr({ hostId: 1 })));
		this.logger = new MockLogger();
		this.server = new MockServer();
		this.name = "test";
		this.id = 7357;
		this.status = "running";
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

class MockHost extends libLink.Link {
	constructor() {
		super(new MockConnector(addr({ hostId: 1 }), addr("controller")));
	}
}

class MockControl extends libLink.Link { }

class MockController {
	constructor() {
		this.app = express();
		this.app.locals.controller = this;
		this.app.locals.streams = new Map();
		this.mockConfigEntries = new Map([
			["controller.external_address", "test"],
			["controller.auth_secret", "TestSecretDoNotUse"],
			["controller.proxy_stream_timeout", 1],
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
		this.hosts = new Map();
	}

	register() {
	}

	getControllerUrl() {
		return "http://controller.example/";
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

async function createControllerPlugin(ControllerPluginClass, info) {
	let controller = new MockController();
	let metrics = {};
	let logger = new MockLogger();
	let plugin = new ControllerPluginClass(info, controller, metrics, logger);
	await plugin.init();
	return plugin;
}

async function createInstancePlugin(InstancePluginClass, info) {
	let instance = new MockInstance();
	let host = new MockHost();
	let plugin = new InstancePluginClass(info, instance, host);
	await plugin.init();
	return plugin;
}


module.exports = {
	MockLogger,
	MockSocket,
	MockConnector,
	MockServer,
	MockInstance,
	MockHost,
	MockControl,
	MockController,

	createControllerPlugin,
	createInstancePlugin,
};
