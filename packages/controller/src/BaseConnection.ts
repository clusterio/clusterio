import path from "path";
import fs from "fs-extra";

import type Controller from "./Controller";
import type WsServerConnector from "./WsServerConnector";

import * as lib from "@clusterio/lib";
const { logger } = lib;
import * as routes from "./routes";


/**
 * Base class for controller connections
 *
 * @extends module:lib.Link
 * @alias module:controller/src/BaseConnection
 */
export default class BaseConnection extends lib.Link {
	declare ["connector"]: WsServerConnector;

	constructor(
		connector: lib.WebSocketBaseConnector,
		public _controller: Controller
	) {
		super(connector);
		this.router = _controller.router;
		for (let [Request, handler] of this._controller._registeredRequests) { this.handle(Request, handler); }
		for (let [Request, handler] of this._controller._fallbackedRequests) { this.fallbackRequest(Request, handler); }
		for (let [Event, handler] of this._controller._registeredEvents) { this.handle(Event, handler); }
		for (let [Event, handler] of this._controller._snoopedEvents) { this.snoopEvent(Event, handler); }

		this.handle(lib.ModPackGetRequest, this.handleModPackGetRequest.bind(this));
		this.handle(lib.ModPackGetDefaultRequest, this.handleModPackGetDefaultRequest.bind(this));
		this.handle(lib.ModDownloadRequest, this.handleModDownloadRequest.bind(this));

		this.handle(lib.SubscriptionRequest, this.handleSubscriptionRequest.bind(this));
		this.connector.on("close", () => {
			this._controller.subscriptions.unsubscribe(this);
		});
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

	getMod(mod: { name: string, version: string, sha1?: string }) {
		let filename = lib.ModInfo.filename(mod.name, mod.version);
		let modInfo = this._controller.modStore.files.get(filename);
		if (!modInfo) {
			throw new lib.RequestError(`Mod ${filename} does not exist on controller`);
		}
		if (mod.sha1 && mod.sha1 !== modInfo.sha1) {
			throw new lib.RequestError(`Mod ${filename} checksum does not match controller's checksum`);
		}
		return modInfo;
	}

	async handleModDownloadRequest(request: lib.ModDownloadRequest) {
		let mod = this.getMod(request);
		let modPath = path.join(this._controller.config.get("controller.mods_directory"), mod.filename);

		let stream = await routes.createProxyStream(this._controller.app);
		stream.filename = mod.filename;
		stream.source = fs.createReadStream(modPath);
		stream.mime = "application/zip";
		stream.size = String(mod.size);

		return stream.id;
	}

	async handleSubscriptionRequest(request: lib.SubscriptionRequest, src: lib.Address, dst: lib.Address) {
		return await this._controller.subscriptions.handleRequest(this, request, src, dst);
	}
}
