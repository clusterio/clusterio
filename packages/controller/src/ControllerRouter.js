"use strict";
const libData = require("@clusterio/lib/data");

class ControllerRouter {
	/** @type {module:controller/src/Controller} */
	controller;

	pendingRequests = new Map();

	constructor(controller) {
		this.controller = controller;
	}

	addHostConnection(connection) {
		this.hostConnections.set(connection.id, connection);
	}

	addControlConnection(connection) {
		this.controlConnections.set(connection.id, connection);
	}

	/**
	 * @param {module:lib/link.Link} origin - Source link of the message.
	 * @param {module:lib/data.Message} message
	 *    Link the message originated from.
	 * @param {boolean} hasFallback - true if fallback handling is available.
	 * @returns {boolean} true if the message was handled
	 */
	forwardMessage(origin, message, hasFallback) {
		if (!["request", "response", "responseError", "event"].includes(message.type)) {
			throw new Error(`Message type ${message.type} can't be forwarded`);
		}

		let dst = message.dst;
		let nextHop;
		let msg;
		if (dst.type === libData.Address.broadcast) {
			this.broadcastMessage(origin, message);
			return true;
		} else if (dst.type === libData.Address.host) {
			nextHop = this.controller.wsServer.hostConnections.get(dst.id);
			if (!nextHop) {
				msg = `Host ${dst.id} is offline`;
			}
		} else if (dst.type === libData.Address.instance) {
			let instance = this.controller.instances.get(dst.id);
			if (!instance) {
				msg = `Instance ${dst.id} does not exist`;
			} else {
				let assignedHost = instance.config.get("instance.assigned_host");
				if (assignedHost === null) {
					msg = `Instance ${dst.id} is not assigned a host`;
				} else {
					nextHop = this.controller.wsServer.hostConnections.get(assignedHost);
					if (!nextHop) {
						msg = `Assigned host for instance ${dst.id} is offline`;
					}
				}
			}
		} else if (dst.type === libData.Address.control) {
			nextHop = this.controller.wsServer.controlConnections.get(dst.id);
			if (!nextHop) {
				msg = "Control connection does not exist";
			}
		} else if (dst.type === libData.Address.controller) {
			msg = `Unexpected message forwarded to ${dst}`;
		}

		if (nextHop === origin) {
			msg = `Message would return back to sender ${origin.dst}.`;
			nextHop = undefined;
		}

		if (message.type === "request") {
			if (!nextHop) {
				if (hasFallback) {
					return false;
				}
				origin.connector.sendResponseError(
					new libData.ResponseError(msg || "Unroutable destination"), message.src
				);
				return true;
			}
		}

		if (nextHop) {
			if (message.type === "request") {
				nextHop.forwardRequest(message, origin);
			} else {
				nextHop.connector.send(message);
			}
		} else {
			this.warnUnrouted(message, msg);
		}

		return true;
	}

	broadcastMessage(origin, message) {
		let dst = message.dst;
		if (message.type !== "event") {
			this.warnUnrouted(message, `Unexpected broadcast of ${message.type}`);
		} else if (dst.id === libData.Address.host || dst.id === libData.Address.instance) {
			for (let hostConnection of this.controller.wsServer.hostConnections.values()) {
				if (hostConnection !== origin) {
					hostConnection.connector.send(message);
				}
			}
		} else if (dst.id === libData.Address.control) {
			for (let controlConnection of this.controller.wsServer.controlConnections.values()) {
				if (controlConnection !== origin) {
					controlConnection.connector.send(message);
				}
			}
		} else {
			this.warnUnrouted(message, `Unexpected broacdast target ${dst.id}`);
		}
	}

	warnUnrouted(message, msg) {
		let dst = message.dst;
		let baseMsg = `No destination for ${message.constructor.name} routed from ${message.src} to ${dst}`;
		logger.warn(msg ? `${baseMsg}: ${msg}.` : `${baseMsg}.`);
	}
}

module.exports = ControllerRouter;
