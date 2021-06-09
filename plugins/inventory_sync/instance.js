/**
 * @module
 */
"use strict";
const libPlugin = require("@clusterio/lib/plugin");
const libLuaTools = require("@clusterio/lib/lua_tools");

class InstancePlugin extends libPlugin.BaseInstancePlugin {
	async init() {
		this.inventoryQueue = [];

		// setInterval(() => {

		// 	console.log("Connected")
		// 	this.info.messages.upload.send(this.instance, {
		// 		instance_id: this.instance.id,
		// 		player: "danielv",
		// 		inventory: "stuff",
		// 	})
		// },5000)


		this.instance.server.on("ipc-inventory_sync_upload", content =>
			this.handleUpload(content).catch(err => this.logger.error(
				`Error handling ipc-inventory_sync_upload:\n${err.stack}`
			))
		)
		this.instance.server.on("ipc-inventory_sync_download", content =>
			this.handleDownload(content).catch(err => this.logger.error(
				`Error handling ipc-inventory_sync_download:\n${err.stack}`
			))
		)
	}

	onMasterConnectionEvent(event) {
		console.log("Connectionevent", event)
		if (event === "connect") {
		}
	}

	async handleUpload(player) {
		console.log("Uploading", player)
		this.info.messages.upload.send(this.instance, {
			instance_id: this.instance.id,
			instance_name: this.instance.name,
			player_name: player.name,
			inventory: JSON.stringify(player),
		})
	}
	async handleDownload(player) {
		console.log("Downloading", player.player_name)
		let response = await this.info.messages.download.send(this.instance, {
			player_name: player.player_name
		})
		if (response.inventory) {
			console.log("Sending command")
			await this.sendRcon(`/sc inventory_sync.downloadInventory('${response.player_name}', '${libLuaTools.escapeString(response.inventory)}')`)
		}
	}

	async chatEventHandler(message) {
		// TODO check if cross server chat is enabled
		let content = `[${message.data.instance_name}] ${removeTags(message.data.content)}`;
		await this.sendRcon(`/sc game.print('${libLuaTools.escapeString(content)}')`, true);
	}

	sendChat(message) {
		this.info.messages.chat.send(this.instance, {
			instance_name: this.instance.name,
			content: message,
		});
	}

	async onOutput(output) {
		if (output.type === "action" && output.action === "INVENTORY") {
			if (this.slave.connector.connected) {
				this.sendChat(output.message);
			} else {
				this.inventoryQueue.push(output.message);
			}
		}
	}
}

module.exports = {
	InstancePlugin,
};
