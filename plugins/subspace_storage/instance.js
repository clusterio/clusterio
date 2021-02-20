"use strict";
const fs = require("fs-extra");

const libPlugin = require("@clusterio/lib/plugin");
const libLuaTools = require("@clusterio/lib/lua_tools");

class InstancePlugin extends libPlugin.BaseInstancePlugin {
	unexpectedError(err) {
		this.logger.error(`Unexpected error:\n${err.stack}`);
	}

	async init() {
		this.instance.server.on("ipc-subspace_storage:output", (output) => {
			this.provideItems(output).catch(err => this.unexpectedError(err));
		});
		this.instance.server.on("ipc-subspace_storage:orders", (orders) => {
			this.requestItems(orders).catch(err => this.unexpectedError(err));
		});
	}

	async onStart() {
		this.pingId = setInterval(() => {
			this.sendRcon(
				"/sc __subspace_storage__ global.ticksSinceMasterPinged = 0", true
			).catch(err => this.unexpectedError(err));
		}, 5000);

		let response = await this.info.messages.getStorage.send(this.instance);
		// TODO Diff with dump of invdata produce minimal command to sync
		let itemsJson = libLuaTools.escapeString(JSON.stringify(response.items));
		await this.sendRcon(`/sc __subspace_storage__ UpdateInvData("${itemsJson}", true)`, true);
	}

	onExit() {
		clearInterval(this.pingId);
	}

	// provide items --------------------------------------------------------------
	async provideItems(items) {
		this.info.messages.place.send(this.instance, {
			items,
			instance_id: this.instance.id,
		});

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Exported the following to master:");
			this.logger.verbose(JSON.stringify(items));
		}
	}

	// request items --------------------------------------------------------------
	async requestItems(items) {
		// Request the items all at once
		let response = await this.info.messages.remove.send(this.instance, {
			instance_id: this.instance.id,
			items,
		});

		if (!response.items.length) {
			return;
		}

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Imported following from master:");
			this.logger.verbose(JSON.stringify(response.items));
		}

		let itemsJson = libLuaTools.escapeString(JSON.stringify(response.items));
		await this.sendRcon(`/sc __subspace_storage__ Import("${itemsJson}")`, true);
	}

	// combinator signals ---------------------------------------------------------
	async updateStorageEventHandler(message, event) {
		let items = message.data.items;

		// XXX this should be moved to instance/clusterio api
		items.push(["signal-unixtime", Math.floor(Date.now()/1000)]);

		let itemsJson = libLuaTools.escapeString(JSON.stringify(items));
		await this.sendRcon(`/sc __subspace_storage__ UpdateInvData("${itemsJson}")`, true);
	}
}

module.exports = {
	InstancePlugin,
};
