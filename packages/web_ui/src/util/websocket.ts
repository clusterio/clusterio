import * as lib from "@clusterio/lib";
import packageJson from "../../package.json";
import BaseWebPlugin from "../BaseWebPlugin";

const { logFilter, logger } = lib;

type accountHandler = (account: lib.AccountDetails) => void;
type hostHandler = (hostDetails: lib.HostDetails) => void;
type instanceHandler = (instanceDetails: lib.InstanceDetails) => void;
type saveListHandler = (saveListEvent: lib.SaveDetails) => void;
type modPackHandler = (modPack: lib.ModPack) => void;
type modInfoHandler = (modInfo: lib.ModInfo) => void;
type userHandler = (rawUser: lib.User) => void;
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

	/** Plugins loaded in the web interface */
	public plugins = new Map<string, BaseWebPlugin>();

	/** Updates not handled by the subscription service */
	accountUpdateHandlers: accountHandler[] = [];
	logHandlers: Map<lib.LogFilter, logHandler[]> = new Map();

	/** Updates handled by the subscription service */
	hostUpdate = new lib.EventSubscriber<lib.HostUpdatesEvent, lib.HostDetails[]>(
		lib.HostUpdatesEvent, event => event.updates,
	);

	instanceUpdate = new lib.EventSubscriber<lib.InstanceDetailsUpdatesEvent, lib.InstanceDetails[]>(
		lib.InstanceDetailsUpdatesEvent, event => event.updates,
	);

	saveListUpdate = new lib.EventSubscriber<lib.InstanceSaveDetailsUpdatesEvent, lib.SaveDetails[]>(
		lib.InstanceSaveDetailsUpdatesEvent, event => event.updates,
	);

	modPackUpdate = new lib.EventSubscriber<lib.ModPackUpdatesEvent, lib.ModPack[]>(
		lib.ModPackUpdatesEvent, event => event.updates,
	);

	modUpdate = new lib.EventSubscriber<lib.ModUpdatesEvent, lib.ModInfo[]>(
		lib.ModUpdatesEvent, event => event.updates,
	);

	userUpdate = new lib.EventSubscriber<lib.UserUpdatesEvent, lib.User[]>(
		lib.UserUpdatesEvent, event => event.updates,
	);

	declare connector: ControlConnector;

	constructor(
		connector: ControlConnector,
	) {
		super(connector);

		this.connector.on("connect", data => {
			this.accountName = data.account.name;
			this.accountRoles = data.account.roles;
			this.emitAccountUpdate();
			this.hostUpdate.connectControl(this).catch(err => logger.error(
				`Unexpected error updating host subscriptions:\n${err.stack}`
			));
			this.instanceUpdate.connectControl(this).catch(err => logger.error(
				`Unexpected error updating instance subscriptions:\n${err.stack}`
			));
			this.saveListUpdate.connectControl(this).catch(err => logger.error(
				`Unexpected error updating save list subscriptions:\n${err.stack}`
			));
			this.modPackUpdate.connectControl(this).catch(err => logger.error(
				`Unexpected error updating mod pack subscriptions:\n${err.stack}`
			));
			this.modUpdate.connectControl(this).catch(err => logger.error(
				`Unexpected error updating mod subscriptions:\n${err.stack}`
			));
			this.userUpdate.connectControl(this).catch(err => logger.error(
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

		for (let event of ["connect", "drop", "resume", "close"] as const) {
			this.connector.on(event, () => {
				for (let plugin of this.plugins.values()) {
					plugin.onControllerConnectionEvent(event);
				}
			});
		}

		this.handle(lib.AccountUpdateEvent, this.handleAccountUpdateEvent.bind(this));
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
				name: this.accountName!,
				roles: this.accountRoles!,
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
