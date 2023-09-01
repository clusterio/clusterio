import * as lib from "@clusterio/lib";
import packageJson from "../../package.json";

const { logFilter, logger } = lib;

type accountHandler = (account: lib.AccountDetails) => void;
type hostHandler = (hostDetails: lib.HostDetails) => void;
type instanceHandler = (instanceDetails: lib.InstanceDetails) => void;
type saveListHandler = (saveListEvent: lib.InstanceSaveListUpdateEvent) => void;
type modPackHandler = (modPack: lib.ModPack) => void;
type modInfoHandler = (modInfo: lib.ModInfo) => void;
type userHandler = (rawUser: lib.RawUser) => void;
type logHandler = (info: { level:string, message:string }) => void;

/**
 * Connector for control connection to controller
 * @private
 */
export class ControlConnector extends lib.WebSocketClientConnector {
	token: string | null = null;

	register() {
		if (!this.token) {
			throw new Error("Token not set");
		}

		logger.verbose("Connector | registering control");
		this.sendHandshake(
			new lib.MessageRegisterControl(
				new lib.RegisterControlData(
					this.token,
					"Clusterio Web UI",
					packageJson.version,
				)
			)
		);
	}
}

/**
 * Handles running the control
 *
 * Connects to the controller over WebSocket and sends commands to it.
 * @static
 */
export class Control extends lib.Link {
	/** Flag indicating the connection is in the process of logging out. */
	loggingOut: boolean = false;
	/** Name of the account this control link is connected as. */
	accountName: string | null = null;
	/** Roles of the account this control link is connected as. */
	accountRoles: lib.AccountRole[] | null = null;
	accountUpdateHandlers: Function[] = [];
	hostUpdateHandlers: Map<number|null, hostHandler[]> = new Map();
	instanceUpdateHandlers: Map<number|null, instanceHandler[]> = new Map();
	saveListUpdateHandlers: Map<number|null, saveListHandler[]> = new Map();
	modPackUpdateHandlers: Map<number|null|undefined, modPackHandler[]> = new Map();
	modUpdateHandlers: Map<string|null, modInfoHandler[]> = new Map();
	userUpdateHandlers: Map<string|null, userHandler[]> = new Map();
	logHandlers: Map<lib.LogFilter, logHandler[]> = new Map();

	declare connector: ControlConnector;

	constructor(
		connector: ControlConnector,
		public plugins: Map<string, lib.BaseWebPlugin>,
	) {
		super(connector);

		for (let plugin of plugins.values()) {
			plugin.control = this;
		}

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
					plugin.onControllerConnectionEvent(event as "connect"|"drop"|"resume"|"close");
				}
			});
		}

		this.handle(lib.AccountUpdateEvent, this.handleAccountUpdateEvent.bind(this));
		this.handle(lib.HostUpdateEvent, this.handleHostUpdateEvent.bind(this));
		this.handle(lib.InstanceDetailsUpdateEvent, this.handleInstanceDetailsUpdateEvent.bind(this));
		this.handle(lib.InstanceSaveListUpdateEvent, this.handleInstanceSaveListUpdateEvent.bind(this));
		this.handle(lib.ModPackUpdateEvent, this.handleModPackUpdateEvent.bind(this));
		this.handle(lib.ModUpdateEvent, this.handleModUpdateEvent.bind(this));
		this.handle(lib.UserUpdateEvent, this.handleUserUpdateEvent.bind(this));
		this.handle(lib.LogMessageEvent, this.handleLogMessageEvent.bind(this));
		this.handle(lib.DebugWsMessageEvent, this.handleDebugWsMessageEvent.bind(this));
	}

	async handleAccountUpdateEvent(event: lib.AccountUpdateEvent) {
		this.accountRoles = event.roles??null;
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

	onAccountUpdate(handler: accountHandler) {
		this.accountUpdateHandlers.push(handler);
	}

	offAccountUpdate(handler: accountHandler) {
		let index = this.accountUpdateHandlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error("Given handler is not registered for account update");
		}
		this.accountUpdateHandlers.splice(index, 1);
	}

	async handleHostUpdateEvent(event: lib.HostUpdateEvent) {
		let handlers: Function[] = ([] as Function[]).concat(
			this.hostUpdateHandlers.get(null) || [],
			this.hostUpdateHandlers.get(event.update.id) || [],
		);
		for (let handler of handlers) {
			handler(event.update);
		}
	}

	async onHostUpdate(id: number|null, handler: hostHandler) {
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

	async offHostUpdate(id: number|null, handler: hostHandler) {
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

		await this.send(new lib.HostSetSubscriptionsRequest(
			this.hostUpdateHandlers.has(null),
			[...this.hostUpdateHandlers.keys()].filter(e => e !== null) as number[],
		));
	}

	async handleInstanceDetailsUpdateEvent(event: lib.InstanceDetailsUpdateEvent) {
		let handlers = ([] as Function[]).concat(
			this.instanceUpdateHandlers.get(null) || [],
			this.instanceUpdateHandlers.get(event.details.id) || [],
		);
		for (let handler of handlers) {
			handler(event.details);
		}
	};

	async onInstanceUpdate(id: number|null, handler: instanceHandler) {
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

	async offInstanceUpdate(id: number|null, handler: instanceHandler) {
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

		await this.send(new lib.InstanceDetailsSetSubscriptionsRequest(
			this.instanceUpdateHandlers.has(null),
			[...this.instanceUpdateHandlers.keys()].filter(e => e !== null) as number[],
		));
	}

	async handleInstanceSaveListUpdateEvent(event: lib.InstanceSaveListUpdateEvent) {
		let handlers = this.saveListUpdateHandlers.get(event.instanceId);
		for (let handler of handlers || []) {
			handler(event);
		}
	};

	async onSaveListUpdate(id: number, handler: saveListHandler) {
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

	async offSaveListUpdate(id: number, handler: saveListHandler) {
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

		await this.send(new lib.InstanceSetSaveListSubscriptionsRequest(
			false,
			[...this.saveListUpdateHandlers.keys()].filter(e => e !== null) as number[],
		));
	}

	async handleModPackUpdateEvent(event: lib.ModPackUpdateEvent) {
		let modPack = event.modPack;

		let handlers = ([] as modPackHandler[]).concat(
			this.modPackUpdateHandlers.get(null) || [],
			this.modPackUpdateHandlers.get(modPack.id) || [],
		);
		for (let handler of handlers) {
			handler(modPack);
		}
	}

	async onModPackUpdate(id: number|null, handler: modPackHandler) {
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

	async offModPackUpdate(id: number|null, handler: modPackHandler) {
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

		await this.send(new lib.ModPackSetSubscriptionsRequest(
			this.modPackUpdateHandlers.has(null),
			[...this.modPackUpdateHandlers.keys()]
				.filter(k => k !== null && k !== undefined) as number[],
		));
	}

	async handleModUpdateEvent(event: lib.ModUpdateEvent) {
		let mod = event.mod;
		let handlers = ([] as modInfoHandler[]).concat(
			this.modUpdateHandlers.get(null) || [],
			this.modUpdateHandlers.get(mod.name) || []
		);
		for (let handler of handlers) {
			handler(mod);
		}
	}

	async onModUpdate(name: string|null, handler: modInfoHandler) {
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

	async offModUpdate(name: string|null, handler: modInfoHandler) {
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

		await this.send(new lib.ModSetSubscriptionsRequest(
			this.modUpdateHandlers.has(null),
			[...this.modUpdateHandlers.keys()].filter(k => k !== null) as string[],
		));
	}

	async handleUserUpdateEvent(event: lib.UserUpdateEvent) {
		let handlers = ([] as userHandler[]).concat(
			this.userUpdateHandlers.get(null) || [],
			this.userUpdateHandlers.get(event.user.name) || [],
		);
		for (let handler of handlers) {
			handler(event.user);
		}
	};

	async onUserUpdate(name: string|null, handler: userHandler) {
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

	async offUserUpdate(name: string|null, handler: userHandler) {
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

		await this.send(new lib.UserSetSubscriptionsRequest(
			this.userUpdateHandlers.has(null),
			[...this.userUpdateHandlers.keys()].filter(e => e !== null) as string[],
		));
	}

	async handleLogMessageEvent(event: lib.LogMessageEvent) {
		let info = event.info;

		for (let [filter, handlers] of this.logHandlers) {
			if (logFilter(filter)(info)) {
				for (let handler of handlers) {
					handler(info);
				}
			}
		}
	}

	async onLog(filter: lib.LogFilter, handler: logHandler) {
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

	async offLog(filter: lib.LogFilter, handler: logHandler) {
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

		let all = false;
		let controller = false;
		let hostIds: number[] = [];
		let instanceIds: number[] = [];

		for (let filter of this.logHandlers.keys()) {
			if (filter.all) { all = true; }
			if (filter.controller) { controller = true; }
			for (let hostId of filter.hostIds || []) {
				if (!hostIds.includes(hostId)) {
					hostIds.push(hostId);
				}
			}
			for (let instanceId of filter.instanceIds || []) {
				if (!instanceIds.includes(instanceId)) {
					instanceIds.push(instanceId);
				}
			}
		}

		await this.send(new lib.LogSetSubscriptionsRequest(all, controller, hostIds, instanceIds, undefined));
	}

	async handleDebugWsMessageEvent(message: lib.DebugWsMessageEvent) {
		// eslint-disable-next-line no-console
		console.log("WS", message.direction, message.content);
	}

	async shutdown() {
		try {
			await this.connector.disconnect();
		} catch (err) {
			if (!(err instanceof lib.SessionLost)) {
				throw err;
			}
		}
	}
}
