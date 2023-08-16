import type Controller from "./Controller";
import type BaseConnection from "./BaseConnection";

import * as lib from "@clusterio/lib";
import HostConnection from "./HostConnection";
import ControlConnection from "./ControlConnection";
const { logger } = lib;

export default class ControllerRouter {
	pendingRequests: Map<any, any> = new Map();

	constructor(
		public controller: Controller
	) {}

	/**
	 * @param origin - Source link of the message.
	 * @param message - Link the message originated from.
	 * @param hasFallback - true if fallback handling is available.
	 * @returns true if the message was handled
	 */
	forwardMessage(
		origin: ControlConnection | HostConnection,
		message: lib.MessageRoutable,
		hasFallback: boolean
	): boolean {
		if (!["request", "response", "responseError", "event"].includes(message.type)) {
			throw new Error(`Message type ${message.type} can't be forwarded`);
		}

		let dst: lib.Address = message.dst;
		let nextHop: ControlConnection | HostConnection | undefined;
		let msg: string = "";
		if (dst.type === lib.Address.broadcast) {
			this.broadcastMessage(origin, message);
			return true;
		} else if (dst.type === lib.Address.host) {
			nextHop = this.controller.wsServer.hostConnections.get(dst.id);
			if (!nextHop) {
				msg = `Host ${dst.id} is offline`;
			}
		} else if (dst.type === lib.Address.instance) {
			let instance = this.controller.instances!.get(dst.id);
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
		} else if (dst.type === lib.Address.control) {
			nextHop = this.controller.wsServer.controlConnections.get(dst.id);
			if (!nextHop) {
				msg = "Control connection does not exist";
			}
		} else if (dst.type === lib.Address.controller) {
			msg = `Unexpected message forwarded to ${dst}`;
		}

		if (nextHop === origin) {
			msg = `Message would return back to sender ${origin.connector.dst}.`;
			nextHop = undefined;
		}

		if (message.type === "request") {
			if (!nextHop) {
				if (hasFallback) {
					return false;
				}
				origin.connector.sendResponseError(
					new lib.ResponseError(msg || "Unroutable destination"), message.src
				);
				return true;
			}
		}

		if (nextHop) {
			if (message.type === "request") {
				nextHop.forwardRequest(message as lib.MessageRequest, origin);
			} else {
				nextHop.connector.send(message);
			}
		} else {
			this.warnUnrouted(message, msg);
		}

		return true;
	}

	broadcastMessage(
		origin: lib.Link,
		message: lib.MessageRoutable,
	) {
		let dst = message.dst;
		if (message.type !== "event") {
			this.warnUnrouted(message, `Unexpected broadcast of ${message.type}`);
		} else if (dst.id === lib.Address.host || dst.id === lib.Address.instance) {
			for (let hostConnection of this.controller.wsServer.hostConnections.values()) {
				if (hostConnection !== origin) {
					hostConnection.connector.send(message);
				}
			}
		} else if (dst.id === lib.Address.control) {
			for (let controlConnection of this.controller.wsServer.controlConnections.values()) {
				if (controlConnection !== origin) {
					controlConnection.connector.send(message);
				}
			}
		} else {
			this.warnUnrouted(message, `Unexpected broacdast target ${dst.id}`);
		}
	}

	warnUnrouted(
		message: lib.MessageRoutable,
		msg: string
	) {
		let dst = message.dst;
		let baseMsg = `No destination for ${message.constructor.name} routed from ${message.src} to ${dst}`;
		logger.warn(msg ? `${baseMsg}: ${msg}.` : `${baseMsg}.`);
	}
}

module.exports = ControllerRouter;
