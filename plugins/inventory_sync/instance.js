/**
 * @module
 */
"use strict";
const libPlugin = require("@clusterio/lib/plugin");
const libLuaTools = require("@clusterio/lib/lua_tools");

/**
 * Splits string into array of strings with max of a certain length
 * @param {Number} chunkSize - Max length of each chunk
 * @param {String} string - String to split into chunks
 * @returns {String[]} Chunks
 */
function chunkify(chunkSize, string) {
	if (string.length <= chunkSize) {
		return [string];
	}
	let chunk = string.substr(0, chunkSize);
	return [chunk, ...chunkify(chunkSize, string.replace(chunk, ""))];
}

class InstancePlugin extends libPlugin.BaseInstancePlugin {
	async init() {
		this.inventoryQueue = [];
		this.instance.server.on("ipc-inventory_sync_upload", content => this.handleUpload(content)
			.catch(err => this.logger.error(`Error handling ipc-inventory_sync_upload:\n${err.stack}`)));
		this.instance.server.on("ipc-inventory_sync_download", content => this.handleDownload(content)
			.catch(err => this.logger.error(`Error handling ipc-inventory_sync_download:\n${err.stack}`)));
	}

	async handleUpload(player) {
		this.logger.verbose(`Uploading ${player.name} (${JSON.stringify(player).length / 1000}kB)`);
		this.info.messages.upload.send(this.instance, {
			instance_id: this.instance.id,
			instance_name: this.instance.name,
			player_name: player.name,
			inventory: JSON.stringify(player),
		});
	}

	async handleDownload(player) {
		this.logger.verbose(`Downloading ${player.player_name}`);
		let response = await this.info.messages.download.send(this.instance, {
			player_name: player.player_name,
		});
		if (response.inventory) {
			const chunkSize = this.instance.config.get("inventory_sync.rcon_chunk_size");
			const chunks = chunkify(chunkSize, response.inventory);
			this.logger.verbose(`Sending inventory for ${player.player_name} in ${chunks.length} chunks`);
			for (let i = 0; i < chunks.length; i++) {
				// this.logger.verbose(`Sending chunk ${i+1} of ${chunks.length}`)
				await this.sendRcon(`/sc inventory_sync.downloadInventory('${response.player_name}', '
				${libLuaTools.escapeString(response.inventory)}', ${i + 1}, ${chunks.length})`);
			}
		}
	}
}

module.exports = {
	InstancePlugin,
};
