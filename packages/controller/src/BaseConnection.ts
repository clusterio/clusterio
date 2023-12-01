import type Controller from "./Controller";
import type WsServerConnector from "./WsServerConnector";

import * as lib from "@clusterio/lib";
const { logger } = lib;
import ControllerRouter from "./ControllerRouter";


/**
 * Base class for controller connections
 *
 * @extends module:lib.Link
 * @alias module:controller/src/BaseConnection
 */
export default class BaseConnection extends lib.Link {
	declare connector: lib.WebSocketBaseConnector;

	constructor(
		connector: lib.WebSocketBaseConnector,
		public _controller: Controller
	) {
		super(connector);
		this.router = new ControllerRouter(this._controller);
		for (let [Request, handler] of this._controller._registeredRequests) { this.handle(Request, handler); }
		for (let [Request, handler] of this._controller._fallbackedRequests) { this.fallbackRequest(Request, handler); }
		for (let [Event, handler] of this._controller._registeredEvents) { this.handle(Event, handler); }
		for (let [Event, handler] of this._controller._snoopedEvents) { this.snoopEvent(Event, handler); }

		this.handle(lib.ModPackGetRequest, this.handleModPackGetRequest.bind(this));
		this.handle(lib.ModPackGetDefaultRequest, this.handleModPackGetDefaultRequest.bind(this));
	}

	async disconnect(code: number, reason: string) {
		try {
			await this.connector.disconnect();
		} catch (err: any) {
			if (!(err instanceof lib.SessionLost)) {
				logger.error(`"Unexpected error preparing disconnect:\n${err.stack}`);
			}
		}
	}

	/**
	 * True if the link is connected, not in the dropped state and not in
	 * the process of disconnecting.
	 */
	get connected(): boolean {
		return this.connector.connected;
	}

	async handleModPackGetRequest(request: lib.ModPackGetRequest): Promise<lib.ModPack> {
		let { id } = request;
		let modPack = this._controller.modPacks.get(id);
		if (!modPack) {
			throw new lib.RequestError(`Mod pack with ID ${id} does not exist`);
		}
		return modPack;
	}

	async handleModPackGetDefaultRequest(): Promise<lib.ModPack> {
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
