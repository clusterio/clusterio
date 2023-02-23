"use strict";
const libErrors = require("@clusterio/lib/errors");
const libLink = require("@clusterio/lib/link");
const { logger } = require("@clusterio/lib/logging");
const libPlugin = require("@clusterio/lib/plugin");


/**
 * Base class for controller connections
 *
 * @extends module:lib/link.Link
 * @alias module:controller/src/BaseConnection
 */
class BaseConnection extends libLink.Link {
	constructor(target, connector, controller) {
		/** @member {module:controller/src/WsServerConnector} module:controller/src/BaseConnection#connector */
		super("controller", target, connector);
		this._controller = controller;
		this._disconnecting = false;
		libLink.attachAllMessages(this);
		for (let controllerPlugin of this._controller.plugins.values()) {
			libPlugin.attachPluginMessages(this, controllerPlugin);
		}
	}

	async forwardRequestToInstance(message, request) {
		return await this._controller.forwardRequestToInstance(request, message.data);
	}

	async forwardEventToInstance(message, event) {
		let instance = this._controller.instances.get(message.data.instance_id);
		if (!instance) { return; }

		let hostId = instance.config.get("instance.assigned_host");
		if (hostId === null) { return; }

		let connection = this._controller.wsServer.hostConnections.get(hostId);
		if (!connection || connection.closing) { return; }
		if (event.plugin && !connection.plugins.has(event.plugin)) { return; }

		event.send(connection, message.data);
	}

	async broadcastEventToHosts(message, event) {
		for (let hostConnection of this._controller.wsServer.hostConnections.values()) {
			// Do not broadcast back to the source
			if (hostConnection === this) { continue; }
			if (hostConnection.connector.closing) { continue; }
			if (event.plugin && !hostConnection.plugins.has(event.plugin)) { continue; }

			event.send(hostConnection, message.data);
		}
	}

	async broadcastEventToInstance(message, event) {
		await this.broadcastEventToHosts(message, event);
	}

	async prepareDisconnectRequestHandler(message, request) {
		await libPlugin.invokeHook(this._controller.plugins, "onPrepareHostDisconnect", this);
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

	async getModPackRequestHandler(message) {
		let { id } = message.data;
		let modPack = this._controller.modPacks.get(id);
		if (!modPack) {
			throw new libErrors.RequestError(`Mod pack with ID ${id} does not exist`);
		}
		return { mod_pack: modPack.toJSON() };
	}

	async getDefaultModPackRequestHandler(message) {
		let id = this._controller.config.get("controller.default_mod_pack_id");
		if (id === null) {
			throw new libErrors.RequestError("Default mod pack not set on controller");
		}
		let modPack = this._controller.modPacks.get(id);
		if (!modPack) {
			throw new libErrors.RequestError(`Default mod pack configured (${id}) does not exist`);
		}
		return { mod_pack: modPack.toJSON() };
	}
}

module.exports = BaseConnection;
