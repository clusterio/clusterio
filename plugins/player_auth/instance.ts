import * as lib from "@clusterio/lib";

import { FetchPlayerCodeRequest, SetVerifyCodeRequest } from "./messages";

type ipcPlayerAuth = {
	type: "open_dialog",
	player: string,
} | {
	type: "set_verify_code",
	player: string,
	verify_code: string,
}

export class InstancePlugin extends lib.BaseInstancePlugin {
	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("player_auth plugin requires save patching.");
		}

		this.instance.server.on("ipc-player_auth", (ipcPlayerAuth: ipcPlayerAuth) => this.handleEvent(ipcPlayerAuth).catch(
			err => this.logger.error(`Error handling event:\n${err.stack}`)
		));
	}

	async handleEvent(event: ipcPlayerAuth) {
		if (event.type === "open_dialog") {
			if (!this.host.connector.connected) {
				await this.sendRcon(`/web-login error ${event.player} login is temporarily unavailable`);
				return;
			}

			let response;
			try {
				response = await this.instance.sendTo("controller", new FetchPlayerCodeRequest(event.player));
			} catch (err: any) {
				await this.sendRcon(`/web-login error ${event.player} ${err.message}`);
				return;
			}
			await this.sendRcon(`/web-login open ${event.player} ${response.controllerUrl} ${response.playerCode}`);

		} else if (event.type === "set_verify_code") {
			try {
				await this.instance.sendTo("controller", new SetVerifyCodeRequest(event.player, event.verify_code));

			} catch (err: any) {
				await this.sendRcon(`/web-login error ${event.player} ${err.message}`);
				return;
			}

			await this.sendRcon(`/web-login code_set ${event.player}`);
		}
	}
}
