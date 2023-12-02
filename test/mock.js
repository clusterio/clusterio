"use strict";
const events = require("events");
const http = require("http");
const express = require("express");

const lib = require("@clusterio/lib");

const UserManager = require("@clusterio/controller/dist/src/UserManager").default;
const ControllerUser = require("@clusterio/controller/dist/src/ControllerUser").default;

const addr = lib.Address.fromShorthand;

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

class MockConnector extends lib.BaseConnector {
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
			await lib.wait(result.time);
		}
		if (result.response instanceof Error) {
			throw result.response;
		}
		return result.response || "";
	}
}

class MockInstance extends lib.Link {
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

class MockHost extends lib.Link {
	constructor() {
		super(new MockConnector(addr({ hostId: 1 }), addr("controller")));
	}
}

class MockControl extends lib.Link { }

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

		this.userManager = new UserManager(this.config);
		this.userManager.roles = new Map([
			[0, lib.Role.fromJSON({ id: 0, name: "Admin", description: "admin", permissions: ["core.admin"] })],
			[1, lib.Role.fromJSON({ id: 1, name: "Player", description: "player", permissions: [] })],
		]);
		this.userManager.roles.get(1).grantDefaultPermissions();

		this.userManager.users = new Map([
			["test", ControllerUser.fromJSON({ name: "test", roles: [0, 1] }, this.userManager)],
			["player", ControllerUser.fromJSON({ name: "player", roles: [1] }, this.userManager)],
		]);
		this.instances = new Map();
		this.hosts = new Map();
		this.handles = new Map();
	}

	handle(eventClass, handler) {
		this.handles.set(eventClass, handler);
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
	lib.registerPluginMessages([info]);
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
