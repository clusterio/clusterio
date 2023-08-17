/**
 * @module
 */
"use strict";
const lib = require("@clusterio/lib");

const {
	AcquireRequest,
	ReleaseRequest,
	UploadRequest,
	DownloadRequest,
} = require("./messages");

/**
 * Splits string into array of strings with max of a certain length
 * @param {Number} chunkSize - Max length of each chunk
 * @param {String} string - String to split into chunks
 * @returns {String[]} Chunks
 */
function chunkify(chunkSize, string) {
	return string.match(new RegExp(`.{1,${chunkSize}}`, "g"));
}

class InstancePlugin extends lib.BaseInstancePlugin {
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
					if (!this.host.connector.connected || this.disconnecting) {
						return;
					}
					this.playersToRelease.delete(player);
					await this.instance.sendTo("controller", new ReleaseRequest(this.instance.id, player_name));
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

		if (this.host.connector.connected && !this.disconnecting) {
			try {
				let acquireResponse = await this.instance.sendTo(
					"controller",
					new AcquireRequest(this.instance.id, request.player_name),
				);
				response = {
					player_name: request.player_name,
					status: acquireResponse.status,
					generation: acquireResponse.generation,
					has_data: acquireResponse.hasData,
					message: acquireResponse.message,
				};
			} catch (err) {
				if (!(err instanceof lib.SessionLost)) {
					this.logger.error(`Unexpected error sending aquire request:\n${err.stack}`);
					response.message = err.message;
				}
			}
		}

		let json = lib.escapeString(JSON.stringify(response));
		await this.sendRcon(`/sc inventory_sync.acquire_response("${json}")`, true);
	}

	async handleRelease(request) {
		if (!this.host.connector.connected) {
			this.playersToRelease.set(request.player_name);
		}

		try {
			await this.instance.sendTo("controller", new ReleaseRequest(this.instance.id, request.player_name));
		} catch (err) {
			if (err instanceof lib.SessionLost) {
				this.playersToRelease.set(request.player_name);
			} else {
				this.logger.error(`Unexpected error releasing player ${request.player_name}:\n${err.stack}`);
			}
		}
	}

	async handleUpload(player_data) {
		if (!this.host.connector.connected || this.disconnecting) {
			return;
		}

		this.logger.verbose(`Uploading ${player_data.name} (${JSON.stringify(player_data).length / 1000}kB)`);
		try {
			await this.instance.sendTo(
				"controller",
				new UploadRequest(this.instance.id, player_data.name, player_data),
			);

		} catch (err) {
			if (!(err instanceof lib.SessionLost)) {
				this.logger.error(`Unexpected error uploading inventory for ${player_data.name}:\n${err.stack}`);
			}
			return;
		}

		await this.sendRcon(
			`/sc inventory_sync.confirm_upload("${player_data.name}", ${player_data.generation})`, true
		);
	}

	async handleDownload(request) {
		const playerName = request.player_name;
		this.logger.verbose(`Downloading ${playerName}`);

		let response = await this.instance.sendTo("controller", new DownloadRequest(this.instance.id, playerName));

		if (!response.player_data) {
			await this.sendRcon(`/sc inventory_sync.download_inventory('${playerName}',nil,0,0)`, true);
			return;
		}

		const chunkSize = this.instance.config.get("inventory_sync.rcon_chunk_size");
		const chunks = chunkify(chunkSize, JSON.stringify(response.player_data));
		this.logger.verbose(`Sending inventory for ${playerName} in ${chunks.length} chunks`);
		for (let i = 0; i < chunks.length; i++) {
			// this.logger.verbose(`Sending chunk ${i+1} of ${chunks.length}`)
			const chunk = lib.escapeString(chunks[i]);
			await this.sendRcon(
				`/sc inventory_sync.download_inventory('${playerName}','${chunk}',${i + 1},${chunks.length})`,
				true
			);
		}
	}
}

module.exports = {
	InstancePlugin,
};
