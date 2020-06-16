const fs = require("fs-extra");

const plugin = require("lib/plugin");
const luaTools = require("lib/luaTools");

function unexpectedError(err) {
	console.log("Unexpected error in subspace_storage");
	console.log("------------------------------------");
	console.log(err);
}

class InstancePlugin extends plugin.BaseInstancePlugin {
	async init() {
		this.instance.server.on("ipc-subspace_storage:output", (output) => {
			this.provideItems(output).catch(unexpectedError);
		});
		this.instance.server.on("ipc-subspace_storage:orders", (orders) => {
			this.requestItems(orders).catch(unexpectedError);
		});
	}

	async onStart() {
		this.pingId = setInterval(() => {
			this.instance.server.sendRcon(
				"/sc __subspace_storage__ global.ticksSinceMasterPinged = 0", true
			).catch(unexpectedError);
		}, 5000);

		let response = await this.info.messages.getStorage.send(this.instance);
		// TODO Diff with dump of invdata produce minimal command to sync
		let itemsJson = luaTools.escapeString(JSON.stringify(response.items));
		await this.instance.server.sendRcon(`/sc __subspace_storage__ UpdateInvData("${itemsJson}", true)`, true);
	}

	onExit() {
		clearInterval(this.pingId);
	}

	// provide items --------------------------------------------------------------
	async provideItems(items) {
		this.info.messages.place.send(this.instance, {
			items,
			instance_id: this.instance.config.get("instance.id"),
		});

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			console.log("Exported the following to master:");
			console.log(items);
		}
	}

	// request items --------------------------------------------------------------
	async requestItems(items) {
		// Request the items all at once
		let response = await this.info.messages.remove.send(this.instance, {
			instance_id: this.instance.config.get("instance.id"),
			items,
		});

		if (!response.items.length) {
			return;
		}

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			console.log("Imported following from master:");
			console.log(response.items);
		}

		let itemsJson = luaTools.escapeString(JSON.stringify(response.items));
		await this.instance.server.sendRcon(`/sc __subspace_storage__ Import("${itemsJson}")`, true);
	}

	// combinator signals ---------------------------------------------------------
	async updateStorageEventHandler(message, event) {
		let items = message.data.items;

		// XXX this should be done on the lua side
		// Ensure counts don't overflow
		for (let item of items) {
			if (item[1] > 0x7fffffff) {
				item[1] = 0x7fffffff;
			}
		}

		// XXX this should be moved to instance/clusterio api
		items.push(["signal-unixtime", Math.floor(Date.now()/1000)]);

		let itemsJson = luaTools.escapeString(JSON.stringify(items));
		await this.instance.server.sendRcon(`/sc __subspace_storage__ UpdateInvData("${itemsJson}")`, true);
	}
}

module.exports = {
	InstancePlugin,
};
