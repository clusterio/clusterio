"use strict";
const libErrors = require("@clusterio/lib/errors");
const libLink = require("@clusterio/lib/link");
const { logger } = require("@clusterio/lib/logging");
const libPlugin = require("@clusterio/lib/plugin");


/**
 * Base class for master server connections
 *
 * @extends module:lib/link.Link
 * @alias module:master/src/BaseConnection
 */
class BaseConnection extends libLink.Link {
	constructor(target, connector, master) {
		/** @member {module:master/src/WsServerConnector} module:master/src/BaseConnection#connector */
		super("master", target, connector);
		this._master = master;
		this._disconnecting = false;
		libLink.attachAllMessages(this);
		for (let masterPlugin of this._master.plugins.values()) {
			libPlugin.attachPluginMessages(this, masterPlugin);
		}
	}

	async forwardRequestToInstance(message, request) {
		return await this._master.forwardRequestToInstance(request, message.data);
	}

	async forwardRequestToSlave(message, request) {
		return await this._master.forwardRequestToSlave(request, message.data);
	}

	async forwardEventToInstance(message, event) {
		let instance = this._master.instances.get(message.data.instance_id);
		if (!instance) { return; }

		let slaveId = instance.config.get("instance.assigned_slave");
		if (slaveId === null) { return; }

		let connection = this._master.wsServer.slaveConnections.get(slaveId);
		if (!connection || connection.closing) { return; }
		if (event.plugin && !connection.plugins.has(event.plugin)) { return; }

		event.send(connection, message.data);
	}

	async broadcastEventToSlaves(message, event) {
		for (let slaveConnection of this._master.wsServer.slaveConnections.values()) {
			// Do not broadcast back to the source
			if (slaveConnection === this) { continue; }
			if (slaveConnection.connector.closing) { continue; }
			if (event.plugin && !slaveConnection.plugins.has(event.plugin)) { continue; }

			event.send(slaveConnection, message.data);
		}
	}

	async broadcastEventToInstance(message, event) {
		await this.broadcastEventToSlaves(message, event);
	}

	async prepareDisconnectRequestHandler(message, request) {
		await libPlugin.invokeHook(this._master.plugins, "onPrepareSlaveDisconnect", this);
		this._disconnecting = true;
		this.connector.setClosing();
		return await super.prepareDisconnectRequestHandler(message, request);
	}

	async disconnect(code, reason) {
		this.connector.setClosing();
		try {
			await libLink.messages.prepareDisconnect.send(this);
		} catch (err) {
			if (!(err instanceof libErrors.SessionLost)) {
				logger.error(`"Unexpected error preparing disconnect:\n${err.stack}`);
			}
		}

		await this.connector.close(code, reason);
	}

	/**
	 * True if the link is connected, not in the dropped state and not in
	 * the process of disconnecting.
	 * @type {boolean}
	 */
	get connected() {
		return !this._disconnecting && this.connector.connected;
	}
}

module.exports = BaseConnection;
