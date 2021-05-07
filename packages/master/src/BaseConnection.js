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
		libLink.attachAllMessages(this);
		for (let masterPlugin of this._master.plugins.values()) {
			libPlugin.attachPluginMessages(this, masterPlugin);
		}
	}

	async forwardRequestToInstance(message, request) {
		let instance = this._master.instances.get(message.data.instance_id);
		if (!instance) {
			throw new libErrors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		let slaveId = instance.config.get("instance.assigned_slave");
		if (slaveId === null) {
			throw new libErrors.RequestError("Instance is not assigned to a slave");
		}

		let connection = this._master.wsServer.slaveConnections.get(slaveId);
		if (!connection) {
			throw new libErrors.RequestError("Slave containing instance is not connected");
		}
		if (request.plugin && !connection.plugins.has(request.plugin)) {
			throw new libErrors.RequestError(`Slave containing instance does not have ${request.plugin} plugin`);
		}

		return await request.send(connection, message.data);
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
		this.connector.setClosing();
		return await super.prepareDisconnectRequestHandler(message, request);
	}

	async disconnect(code, reason) {
		try {
			await libLink.messages.prepareDisconnect.send(this);
		} catch (err) {
			if (!(err instanceof libErrors.SessionLost)) {
				logger.error(`"Unexpected error preparing disconnect:\n${err.stack}`);
			}
		}

		await this.connector.close(code, reason);
	}
}

module.exports = BaseConnection;
