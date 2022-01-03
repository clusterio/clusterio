/**
 * @module
 */
"use strict";
const libPlugin = require("@clusterio/lib/plugin");


class InstancePlugin extends libPlugin.BaseInstancePlugin {
	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("player_auth plugin requires save patching.");
		}

		this.instance.server.on("ipc-player_auth", event => this.handleEvent(event).catch(
			err => this.logger.error(`Error handling event:\n${err.stack}`)
		));
	}

	async handleEvent(event) {
		if (event.type === "open_dialog") {
			if (!this.slave.connector.connected) {
				await this.sendRcon(`/web-login error ${event.player} login is temporarily unavailable`);
				return;
			}

			let response;
			try {
				response = await this.info.messages.fetchPlayerCode.send(this.instance, { player: event.player });
			} catch (err) {
				await this.sendRcon(`/web-login error ${event.player} ${err.message}`);
				return;
			}
			await this.sendRcon(`/web-login open ${event.player} ${response.master_url} ${response.player_code}`);

		} else if (event.type === "set_verify_code") {
			try {
				await this.info.messages.setVerifyCode.send(this.instance, {
					player: event.player,
					verify_code: event.verify_code,
				});

			} catch (err) {
				await this.sendRcon(`/web-login error ${event.player} ${err.message}`);
				return;
			}

			await this.sendRcon(`/web-login code_set ${event.player}`);
		}
	}
}

module.exports = {
	InstancePlugin,
};
