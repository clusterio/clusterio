import libLink from "@clusterio/lib/link";
import libPlugin from "@clusterio/lib/plugin";
import libErrors from "@clusterio/lib/errors";
import { logger } from "@clusterio/lib/logging";
import packageJson from "../../package.json";


/**
 * Connector for control connection to master server
 * @private
 */
export class ControlConnector extends libLink.WebSocketClientConnector {
	constructor(url, reconnectDelay) {
		super(url, reconnectDelay);
		this.token = null;
	}

	register() {
		if (!this.token) {
			throw new Error("Token not set");
		}

		logger.verbose("SOCKET | registering control");
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
 * Connects to the master server over WebSocket and sends commands to it.
 * @static
 */
export class Control extends libLink.Link {
	constructor(connector, plugins) {
		super("control", "master", connector);
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

		this.instanceLogHandlers = new Map();

		this.connector.on("connect", data => {
			this.accountName = data.account.name;
			this.updateLogSubscriptions().catch(err => logger.error(
				`Unexpected error updating log subscriptions:\n${err.stack}`
			));
		});

		this.connector.on("close", () => {
			this.accountName = null;
		});

		for (let event of ["connect", "drop", "resume", "close"]) {
			this.connector.on(event, () => {
				for (let plugin of this.plugins.values()) {
					plugin.onMasterConnectionEvent(event);
				}
			});
		}
	}

	async logMessageEventHandler(message) {
		let info = message.data.info;

		if (info.instance_id !== undefined) {
			let instanceHandlers = this.instanceLogHandlers.get(info.instance_id);
			for (let handler of instanceHandlers || []) {
				handler(info);
			}
		}
	}

	async onInstanceLog(id, handler) {
		if (!Number.isInteger(id)) {
			throw new Error("Invalid instance id");
		}

		let handlers = this.instanceLogHandlers.get(id);
		if (!handlers) {
			handlers = [];
			this.instanceLogHandlers.set(id, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateLogSubscriptions();
		}
	}

	async offInstanceLog(id, handler) {
		let handlers = this.instanceLogHandlers.get(id);
		if (!handlers || !handlers.length) {
			throw new Error(`No handlers for instance ${id} exist`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for instance ${id}`);
		}

		handlers.splice(index, 1);
		if (!handlers.length) {
			await this.updateLogSubscriptions();
		}
	}

	async updateLogSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		await libLink.messages.setLogSubscriptions.send(this, {
			all: false,
			master: false,
			slave_ids: [],
			instance_ids: [...this.instanceLogHandlers.keys()],
			max_level: null,
		});
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
