const libLink = require("@clusterio/lib/link");
const libPlugin = require("@clusterio/lib/plugin");
const libErrors = require("@clusterio/lib/errors");
const version = require("../../package.json").version;


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

		console.log("SOCKET | registering control");
		this.sendHandshake("register_control", {
			token: this.token,
			agent: "Clusterio Web UI",
			version,
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

		this.instanceOutputHandlers = new Map();
	}

	async instanceOutputEventHandler(message) {
		let { instance_id, output } = message.data;
		let handlers = this.instanceOutputHandlers.get(instance_id);
		for (let handler of handlers || []) {
			handler(output);
		}
	}

	async onInstanceOutput(id, handler) {
		if (!Number.isInteger(id)) {
			throw new Error("Invalid instance id");
		}

		let handlers = this.instanceOutputHandlers.get(id);
		if (!handlers) {
			handlers = [];
			this.instanceOutputHandlers.set(id, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateInstanceOutputSubscriptions();
		}
	}

	async offInstanceOutput(id, handler) {
		let handlers = this.instanceOutputHandlers.get(id);
		if (!handlers || !handlers.length) {
			throw new Error(`No handlers for instance ${id} exist`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for instance ${id}`);
		}

		handlers.splice(index, 1);
		if (!handlers.length) {
			await this.updateInstanceOutputSubscriptions();
		}
	}

	async updateInstanceOutputSubscriptions() {
		await libLink.messages.setInstanceOutputSubscriptions.send(this, {
			instance_ids: [...this.instanceOutputHandlers.keys()],
		});
	}

	async debugWsMessageEventHandler(message) {
		console.log("WS", message.data.direction, message.data.content);
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
