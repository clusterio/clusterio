/**
 * @module
 */
"use strict";
const libErrors = require("@clusterio/lib/errors");
const libPlugin = require("@clusterio/lib/plugin");
const libLuaTools = require("@clusterio/lib/lua_tools");

/**
 * Splits string into array of strings with max of a certain length
 * @param {Number} chunkSize - Max length of each chunk
 * @param {String} string - String to split into chunks
 * @returns {String[]} Chunks
 */
function chunkify(chunkSize, string) {
	return string.match(new RegExp(`.{1,${chunkSize}}`, "g"));
}

class InstancePlugin extends libPlugin.BaseInstancePlugin {
	async init() {
		this.playersToRelease = new Set();
		this.disconnecting = false;

		// Handle IPC from scenario script
		this.instance.server.on("ipc-inventory_sync_acquire", content => this.handleAcquire(content)
			.catch(err => this.logger.error(`Error handling ipc-inventory_sync_acquire:\n${err.stack}`)));
		this.instance.server.on("ipc-inventory_sync_release", content => this.handleRelease(content)
			.catch(err => this.logger.error(`Error handling ipc-inventory_sync_release:\n${err.stack}`)));
		this.instance.server.on("ipc-inventory_sync_upload", content => this.handleUpload(content)
			.catch(err => this.logger.error(`Error handling ipc-inventory_sync_upload:\n${err.stack}`)));
		this.instance.server.on("ipc-inventory_sync_download", content => this.handleDownload(content)
			.catch(err => this.logger.error(`Error handling ipc-inventory_sync_download:\n${err.stack}`)));
	}

	onPrepareControllerDisconnect() {
		this.disconnecting = true;
	}

	onControllerConnectionEvent(event) {
		if (event === "connect") {
			this.disconnecting = false;
			(async () => {
				for (let player_name of this.playersToRelease) {
					if (!this.slave.connector.connected || this.disconnecting) {
						return;
					}
					this.playersToRelease.delete(player);
					await this.info.messages.release.send(this.instance, {
						instance_id: this.instance.id,
						player_name,
					});
				}
			})().catch(
				err => this.logger.error(`Unpexpected error releasing queued up players:\n${err.stack}`)
			);
		}
	}

	async handleAcquire(request) {
		let response = {
			player_name: request.player_name,
			status: "error",
			message: "Controller is temporarily unavailable",
		};

		if (this.slave.connector.connected && !this.disconnecting) {
			try {
				response = {
					player_name: request.player_name,
					...await this.info.messages.acquire.send(this.instance, {
						instance_id: this.instance.id,
						player_name: request.player_name,
					}),
				};
			} catch (err) {
				if (!(err instanceof libErrors.SessionLost)) {
					this.logger.error(`Unexpected error sending aquire request:\n${err.stack}`);
					response.message = err.message;
				}
			}
		}

		let json = libLuaTools.escapeString(JSON.stringify(response));
		await this.sendRcon(`/sc inventory_sync.acquire_response("${json}")`, true);
	}

	async handleRelease(request) {
		if (!this.slave.connector.connected) {
			this.playersToRelease.set(request.player_name);
		}

		try {
			await this.info.messages.release.send(this.instance, {
				instance_id: this.instance.id,
				player_name: request.player_name,
			});
		} catch (err) {
			if (err instanceof libErrors.SessionLost) {
				this.playersToRelease.set(request.player_name);
			} else {
				this.logger.error(`Unexpected error releasing player ${request.player_name}:\n${err.stack}`);
			}
		}
	}

	async handleUpload(player_data) {
		if (!this.slave.connector.connected || this.disconnecting) {
			return;
		}

		this.logger.verbose(`Uploading ${player_data.name} (${JSON.stringify(player_data).length / 1000}kB)`);
		try {
			await this.info.messages.upload.send(this.instance, {
				instance_id: this.instance.id,
				player_name: player_data.name,
				player_data: player_data,
			});

		} catch (err) {
			if (!(err instanceof libErrors.SessionLost)) {
				this.logger.error(`Unexpected error uploading inventory for ${player_data.name}:\n${err.stack}`);
			}
			return;
		}

		await this.sendRcon(
			`/sc inventory_sync.confirm_upload("${player_data.name}", ${player_data.generation})`, true
		);
	}

	async handleDownload(request) {
		const player_name = request.player_name;
		this.logger.verbose(`Downloading ${player_name}`);

		let response = await this.info.messages.download.send(this.instance, {
			instance_id: this.instance.id,
			player_name,
		});

		if (!response.player_data) {
			await this.sendRcon(`/sc inventory_sync.download_inventory('${player_name}',nil,0,0)`, true);
			return;
		}

		const chunkSize = this.instance.config.get("inventory_sync.rcon_chunk_size");
		const chunks = chunkify(chunkSize, JSON.stringify(response.player_data));
		this.logger.verbose(`Sending inventory for ${player_name} in ${chunks.length} chunks`);
		for (let i = 0; i < chunks.length; i++) {
			// this.logger.verbose(`Sending chunk ${i+1} of ${chunks.length}`)
			const chunk = libLuaTools.escapeString(chunks[i]);
			await this.sendRcon(
				`/sc inventory_sync.download_inventory('${player_name}','${chunk}',${i + 1},${chunks.length})`,
				true
			);
		}
	}
}

module.exports = {
	InstancePlugin,
};
