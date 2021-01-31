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

		this.liveUpdateSlaveHandles = [];
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
	constructor(connector, controlPlugins) {
		super("control", "master", connector);
		libLink.attachAllMessages(this);

		/**
		 * Mapping of plugin names to their instance for loaded plugins.
		 * @type {Map<string, module:lib/plugin.BaseControlPlugin>}
		 */
		this.plugins = controlPlugins;
		for (let controlPlugin of controlPlugins.values()) {
			libPlugin.attachPluginMessages(this, controlPlugin.info, controlPlugin);
		}

		this.instanceLogHandlers = new Map();

		this.connector.on("connect", () => {
			this.updateLogSubscriptions().catch(err => logger.error(
				`Unexpected error updating log subscriptions:\n${err.stack}`
			));
		});

		this.liveUpdateSlaveHandlers = [];
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

	async onLiveSlaveAdded(handler) {
		if (this.liveUpdateSlaveHandlers.length === 0) {
			libLink.messages.setLiveSlaveSubscription.send(this, {});
		}
		this.liveUpdateSlaveHandlers.push(handler);
	}

	async liveUpdateSlavesEventHandler(message) {
		for (let handler of this.liveUpdateSlaveHandlers) {
			handler(message);
		}
	}

	async shutdown() {
		this.connector.setTimeout(30);

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
