"use strict";
const lib = require("@clusterio/lib");
const { logger } = lib;
const ControllerRouter = require("./ControllerRouter");


/**
 * Base class for controller connections
 *
 * @extends module:lib.Link
 * @alias module:controller/src/BaseConnection
 */
class BaseConnection extends lib.Link {
	constructor(connector, controller) {
		/** @member {module:controller/src/WsServerConnector} module:controller/src/BaseConnection#connector */
		super(connector);
		this.router = new ControllerRouter(controller);
		this._controller = controller;
		for (let [Request, handler] of controller._registeredRequests) { this.handle(Request, handler); }
		for (let [Request, handler] of controller._fallbackedRequests) { this.fallbackRequest(Request, handler); }
		for (let [Event, handler] of controller._registeredEvents) { this.handle(Event, handler); }
		for (let [Event, handler] of controller._snoopedEvents) { this.snoopEvent(Event, handler); }

		this.handle(lib.ModPackGetRequest, this.handleModPackGetRequest.bind(this));
		this.handle(lib.ModPackGetDefaultRequest, this.handleModPackGetDefaultRequest.bind(this));
	}

	async disconnect(code, reason) {
		try {
			await this.connector.disconnect();
		} catch (err) {
			if (!(err instanceof lib.SessionLost)) {
				logger.error(`"Unexpected error preparing disconnect:\n${err.stack}`);
			}
		}
	}

	/**
	 * True if the link is connected, not in the dropped state and not in
	 * the process of disconnecting.
	 * @type {boolean}
	 */
	get connected() {
		return this.connector.connected;
	}

	async handleModPackGetRequest(request) {
		let { id } = request;
		let modPack = this._controller.modPacks.get(id);
		if (!modPack) {
			throw new lib.RequestError(`Mod pack with ID ${id} does not exist`);
		}
		return modPack;
	}

	async handleModPackGetDefaultRequest() {
		let id = this._controller.config.get("controller.default_mod_pack_id");
		if (id === null) {
			throw new lib.RequestError("Default mod pack not set on controller");
		}
		let modPack = this._controller.modPacks.get(id);
		if (!modPack) {
			throw new lib.RequestError(`Default mod pack configured (${id}) does not exist`);
		}
		return modPack;
	}
}

module.exports = BaseConnection;
