"use strict";
const lib = require("@clusterio/lib");

const {
	PlaceEvent,
	RemoveRequest,
	GetStorageRequest,
	UpdateStorageEvent,
} = require("./messages");

class InstancePlugin extends lib.BaseInstancePlugin {
	unexpectedError(err) {
		this.logger.error(`Unexpected error:\n${err.stack}`);
	}

	async init() {
		this.pendingTasks = new Set();
		this.instance.server.on("ipc-subspace_storage:output", (output) => {
			this.provideItems(output).catch(err => this.unexpectedError(err));
		});
		this.instance.server.on("ipc-subspace_storage:orders", (orders) => {
			if (this.instance.status !== "running" || !this.host.connected) {
				return;
			}

			let task = this.requestItems(orders).catch(err => this.unexpectedError(err));
			this.pendingTasks.add(task);
			task.finally(() => { this.pendingTasks.delete(task); });
		});

		this.instance.handle(UpdateStorageEvent, this.handleUpdateStorageEvent.bind(this));
	}

	async onStart() {
		this.pingId = setInterval(() => {
			if (!this.host.connected) {
				return; // Only ping if we are actually connected to the controller.
			}
			this.sendRcon(
				"/sc __subspace_storage__ global.ticksSinceMasterPinged = 0", true
			).catch(err => this.unexpectedError(err));
		}, 5000);

		let items = await this.instance.sendTo("controller", new GetStorageRequest());
		// TODO Diff with dump of invdata produce minimal command to sync
		let itemsJson = lib.escapeString(JSON.stringify(items));
		await this.sendRcon(`/sc __subspace_storage__ UpdateInvData("${itemsJson}", true)`, true);
	}

	async onStop() {
		clearInterval(this.pingId);
		await Promise.all(this.pendingTasks);
	}

	onExit() {
		clearInterval(this.pingId);
	}

	// provide items --------------------------------------------------------------
	async provideItems(items) {
		if (!this.host.connector.hasSession) {
			// For now the items are voided if the controller connection is
			// down, which is no different from the previous behaviour.
			if (this.instance.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose("Voided the following items:");
				this.logger.verbose(JSON.stringify(items));
			}
			return;
		}

		this.instance.sendTo("controller", new PlaceEvent(items));

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Exported the following to controller:");
			this.logger.verbose(JSON.stringify(items));
		}
	}

	// request items --------------------------------------------------------------
	async requestItems(requestItems) {
		// Request the items all at once
		let items = await this.instance.sendTo("controller", new RemoveRequest(requestItems));

		if (!items.length) {
			return;
		}

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Imported following from controller:");
			this.logger.verbose(JSON.stringify(items));
		}

		let itemsJson = lib.escapeString(JSON.stringify(items));
		await this.sendRcon(`/sc __subspace_storage__ Import("${itemsJson}")`, true);
	}

	// combinator signals ---------------------------------------------------------
	async handleUpdateStorageEvent(request) {
		if (this.instance.status !== "running") {
			return;
		}
		let items = request.items;

		// XXX this should be moved to instance/clusterio api
		items.push(["signal-unixtime", Math.floor(Date.now()/1000)]);

		let itemsJson = lib.escapeString(JSON.stringify(items));
		let task = this.sendRcon(`/sc __subspace_storage__ UpdateInvData("${itemsJson}")`, true);
		this.pendingTasks.add(task);
		task.finally(() => { this.pendingTasks.delete(task); });
		await task;
	}
}

module.exports = {
	InstancePlugin,
};
