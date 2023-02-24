import { libData, libErrors, libLink, libLogging, libPlugin } from "@clusterio/lib";
const { logFilter, logger } = libLogging;
import packageJson from "../../package.json";


/**
 * Connector for control connection to controller
 * @private
 */
export class ControlConnector extends libLink.WebSocketClientConnector {
	constructor(url, maxReconnectDelay) {
		super(url, maxReconnectDelay);
		this.token = null;
	}

	register() {
		if (!this.token) {
			throw new Error("Token not set");
		}

		logger.verbose("Connector | registering control");
		this.sendHandshake("register_control", {
			token: this.token,
			agent: "Clusterio Web UI",
			version: packageJson.version,
		});
	}
}

/**
 * Handles running the control
 *
 * Connects to the controller over WebSocket and sends commands to it.
 * @static
 */
export class Control extends libLink.Link {
	constructor(connector, plugins) {
		super("control", "controller", connector);
		libLink.attachAllMessages(this);

		/**
		 * Mapping of plugin names to their instance for loaded plugins.
		 * @type {Map<string, module:lib/plugin.BaseWebPlugin>}
		 */
		this.plugins = plugins;
		for (let plugin of plugins.values()) {
			plugin.control = this;
			libPlugin.attachPluginMessages(this, plugin);
		}

		/**
		 * Flag indicating the connection is in the process of logging out.
		 * @type {boolean}
		 */
		this.loggingOut = false;

		/**
		 * Name of the account this control link is connected as.
		 * @type {?string}
		 */
		this.accountName = null;

		/**
		 * Roles of the account this control link is connected as.
		 * @type {?Array<object>}
		 */
		this.accountRoles = null;

		this.accountUpdateHandlers = [];
		this.hostUpdateHandlers = new Map();
		this.instanceUpdateHandlers = new Map();
		this.saveListUpdateHandlers = new Map();
		this.modPackUpdateHandlers = new Map();
		this.modUpdateHandlers = new Map();
		this.userUpdateHandlers = new Map();
		this.logHandlers = new Map();

		this.connector.on("connect", data => {
			this.accountName = data.account.name;
			this.accountRoles = data.account.roles;
			this.emitAccountUpdate();
			this.updateHostSubscriptions().catch(err => logger.error(
				`Unexpected error updating host subscriptions:\n${err.stack}`
			));
			this.updateInstanceSubscriptions().catch(err => logger.error(
				`Unexpected error updating instance subscriptions:\n${err.stack}`
			));
			this.updateSaveListSubscriptions().catch(err => logger.error(
				`Unexpected error updating save list subscriptions:\n${err.stack}`
			));
			this.updateModPackSubscriptions().catch(err => logger.error(
				`Unexpected error updating mod pack subscriptions:\n${err.stack}`
			));
			this.updateModSubscriptions().catch(err => logger.error(
				`Unexpected error updating mod subscriptions:\n${err.stack}`
			));
			this.updateUserSubscriptions().catch(err => logger.error(
				`Unexpected error updating user subscriptions:\n${err.stack}`
			));
			this.updateLogSubscriptions().catch(err => logger.error(
				`Unexpected error updating log subscriptions:\n${err.stack}`
			));
		});

		this.connector.on("close", () => {
			this.accountName = null;
			this.accountRoles = null;
			this.emitAccountUpdate();
		});

		for (let event of ["connect", "drop", "resume", "close"]) {
			this.connector.on(event, () => {
				for (let plugin of this.plugins.values()) {
					plugin.onControllerConnectionEvent(event);
				}
			});
		}
	}

	async accountUpdateEventHandler(message) {
		this.accountRoles = message.data.roles;
		this.emitAccountUpdate();
	}

	emitAccountUpdate() {
		for (let handler of this.accountUpdateHandlers) {
			handler({
				name: this.accountName,
				roles: this.accountRoles,
			});
		}
	}

	onAccountUpdate(handler) {
		this.accountUpdateHandlers.push(handler);
	}

	offAccountUpdate(handler) {
		let index = this.accountUpdateHandlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error("Given handler is not registered for account update");
		}
		this.accountUpdateHandlers.splice(index, 1);
	}

	async hostUpdateEventHandler(message) {
		let handlers = [].concat(
			this.hostUpdateHandlers.get(null) || [],
			this.hostUpdateHandlers.get(message.data.id) || [],
		);
		for (let handler of handlers) {
			handler(message.data);
		}
	}

	async onHostUpdate(id, handler) {
		if (id !== null && !Number.isInteger(id)) {
			throw new Error("Invalid host id");
		}

		let handlers = this.hostUpdateHandlers.get(id);
		if (!handlers) {
			handlers = [];
			this.hostUpdateHandlers.set(id, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateHostSubscriptions();
		}
	}

	async offHostUpdate(id, handler) {
		let handlers = this.hostUpdateHandlers.get(id);
		if (!handlers || !handlers.length) {
			throw new Error(`No handlers for host ${id} exists`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for host ${id}`);
		}

		handlers.splice(index, 1);
		if (!handlers.length) {
			this.hostUpdateHandlers.delete(id);
			await this.updateHostSubscriptions();
		}
	}

	async updateHostSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		await libLink.messages.setHostSubscriptions.send(this, {
			all: this.hostUpdateHandlers.has(null),
			host_ids: [...this.hostUpdateHandlers.keys()].filter(e => e !== null),
		});
	}

	async instanceUpdateEventHandler(message) {
		let handlers = [].concat(
			this.instanceUpdateHandlers.get(null) || [],
			this.instanceUpdateHandlers.get(message.data.id) || [],
		);
		for (let handler of handlers) {
			handler(message.data);
		}
	};

	async onInstanceUpdate(id, handler) {
		if (id !== null && !Number.isInteger(id)) {
			throw new Error("Invalid instance id");
		}

		let handlers = this.instanceUpdateHandlers.get(id);
		if (!handlers) {
			handlers = [];
			this.instanceUpdateHandlers.set(id, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateInstanceSubscriptions();
		}
	}

	async offInstanceUpdate(id, handler) {
		let handlers = this.instanceUpdateHandlers.get(id);
		if (!handlers || !handlers.length) {
			throw new Error(`No handlers for instance ${id} exist`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for instance ${id}`);
		}

		handlers.splice(index, 1);
		if (!handlers.length) {
			this.instanceUpdateHandlers.delete(id);
			await this.updateInstanceSubscriptions();
		}
	}

	async updateInstanceSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		await libLink.messages.setInstanceSubscriptions.send(this, {
			all: this.instanceUpdateHandlers.has(null),
			instance_ids: [...this.instanceUpdateHandlers.keys()].filter(e => e !== null),
		});
	}

	async saveListUpdateEventHandler(message) {
		let handlers = this.saveListUpdateHandlers.get(message.data.instance_id);
		for (let handler of handlers || []) {
			handler(message.data);
		}
	};

	async onSaveListUpdate(id, handler) {
		if (!Number.isInteger(id)) {
			throw new Error("Invalid instance id");
		}

		let handlers = this.saveListUpdateHandlers.get(id);
		if (!handlers) {
			handlers = [];
			this.saveListUpdateHandlers.set(id, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateSaveListSubscriptions();
		}
	}

	async offSaveListUpdate(id, handler) {
		let handlers = this.saveListUpdateHandlers.get(id);
		if (!handlers) {
			throw new Error(`No handlers for instance ${id} exists`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for instance ${id}`);
		}

		handlers.splice(index, 1);
		if (!handlers.length) {
			this.saveListUpdateHandlers.delete(id);
			await this.updateSaveListSubscriptions();
		}
	}

	async updateSaveListSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		await libLink.messages.setSaveListSubscriptions.send(this, {
			all: false,
			instance_ids: [...this.saveListUpdateHandlers.keys()],
		});
	}

	async modPackUpdateEventHandler(message) {
		let modPack = libData.ModPack.fromJSON(message.data.mod_pack);
		let handlers = [].concat(
			this.modPackUpdateHandlers.get(null) || [],
			this.modPackUpdateHandlers.get(modPack.id) || [],
		);
		for (let handler of handlers) {
			handler(modPack);
		}
	}

	async onModPackUpdate(id, handler) {
		if (id !== null && typeof id !== "number") {
			throw new Error("Invalid mod pack id");
		}

		let handlers = this.modPackUpdateHandlers.get(id);
		if (!handlers) {
			handlers = [];
			this.modPackUpdateHandlers.set(id, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateModPackSubscriptions();
		}
	}

	async offModPackUpdate(id, handler) {
		let handlers = this.modPackUpdateHandlers.get(id);
		if (!handlers || !handlers.length) {
			throw new Error(`No handlers for mod pack ${id} exist`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for mod pack ${id}`);
		}

		handlers.splice(index, 1);
		if (!handlers.length) {
			this.modPackUpdateHandlers.delete(id);
			await this.updateModPackSubscriptions();
		}
	}

	async updateModPackSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		await libLink.messages.setModPackSubscriptions.send(this, {
			all: this.modPackUpdateHandlers.has(null),
			mod_pack_ids: [...this.modPackUpdateHandlers.keys()].filter(k => k !== null),
		});
	}

	async modUpdateEventHandler(message) {
		let mod = libData.ModInfo.fromJSON(message.data.mod);
		let handlers = [].concat(
			this.modUpdateHandlers.get(null) || [],
			this.modUpdateHandlers.get(mod.name) || []
		);
		for (let handler of handlers) {
			handler(mod);
		}
	}

	async onModUpdate(name, handler) {
		if (name !== null && typeof name !== "string") {
			throw new Error("Invalid mod name");
		}

		let handlers = this.modUpdateHandlers.get(name);
		if (!handlers) {
			handlers = [];
			this.modUpdateHandlers.set(name, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateModSubscriptions();
		}
	}

	async offModUpdate(name, handler) {
		let handlers = this.modUpdateHandlers.get(name);
		if (!handlers || !handlers.length) {
			throw new Error(`No handlers for mod ${name} exist`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for mod ${name}`);
		}

		handlers.splice(index, 1);
		if (!handlers.length) {
			this.modUpdateHandlers.delete(name);
			await this.updateModSubscriptions();
		}
	}

	async updateModSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		await libLink.messages.setModSubscriptions.send(this, {
			all: this.modUpdateHandlers.has(null),
			mod_names: [...this.modUpdateHandlers.keys()].filter(k => k !== null),
		});
	}

	async userUpdateEventHandler(message) {
		let handlers = [].concat(
			this.userUpdateHandlers.get(null) || [],
			this.userUpdateHandlers.get(message.data.name) || [],
		);
		for (let handler of handlers) {
			handler(message.data);
		}
	};

	async onUserUpdate(name, handler) {
		if (name !== null && typeof name !== "string") {
			throw new Error("Invalid user name");
		}

		let handlers = this.userUpdateHandlers.get(name);
		if (!handlers) {
			handlers = [];
			this.userUpdateHandlers.set(name, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateUserSubscriptions();
		}
	}

	async offUserUpdate(name, handler) {
		let handlers = this.userUpdateHandlers.get(name);
		if (!handlers || !handlers.length) {
			throw new Error(`No handlers for user ${name} exist`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for user ${name}`);
		}

		handlers.splice(index, 1);
		if (!handlers.length) {
			this.userUpdateHandlers.delete(name);
			await this.updateUserSubscriptions();
		}
	}

	async updateUserSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		await libLink.messages.setUserSubscriptions.send(this, {
			all: this.userUpdateHandlers.has(null),
			names: [...this.userUpdateHandlers.keys()].filter(e => e !== null),
		});
	}

	async logMessageEventHandler(message) {
		let info = message.data.info;

		for (let [filter, handlers] of this.logHandlers) {
			if (logFilter(filter)(info)) {
				for (let handler of handlers) {
					handler(info);
				}
			}
		}
	}

	async onLog(filter, handler) {
		let handlers = this.logHandlers.get(filter);
		if (!handlers) {
			handlers = [];
			this.logHandlers.set(filter, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateLogSubscriptions();
		}
	}

	async offLog(filter, handler) {
		let handlers = this.logHandlers.get(filter);
		if (!handlers || !handlers.length) {
			throw new Error("No handlers for the given filter exists");
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error("Given handler is not registered for the filter");
		}

		handlers.splice(index, 1);
		if (!handlers.length) {
			this.logHandlers.delete(filter);
			await this.updateLogSubscriptions();
		}
	}

	async updateLogSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		let combinedFilter = {
			all: false,
			controller: false,
			host_ids: [],
			instance_ids: [],
		};

		for (let filter of this.logHandlers.keys()) {
			if (filter.all) { combinedFilter.all = true; }
			if (filter.controller) { combinedFilter.controller = true; }
			for (let hostId of filter.host_ids || []) {
				if (!combinedFilter.host_ids.includes(hostId)) {
					combinedFilter.host_ids.push(hostId);
				}
			}
			for (let instanceId of filter.instance_ids || []) {
				if (!combinedFilter.instance_ids.includes(instanceId)) {
					combinedFilter.instance_ids.push(instanceId);
				}
			}
		}

		await libLink.messages.setLogSubscriptions.send(this, { ...combinedFilter, max_level: null });
	}

	async debugWsMessageEventHandler(message) {
		// eslint-disable-next-line no-console
		console.log("WS", message.data.direction, message.data.content);
	}

	async shutdown() {
		try {
			await libLink.messages.prepareDisconnect.send(this);
		} catch (err) {
			if (!(err instanceof libErrors.SessionLost)) {
				throw err;
			}
		}

		await this.connector.close(1000, "Control Quit");
	}
}
