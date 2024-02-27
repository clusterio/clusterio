import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";

import {
	PlaceEvent,
	RemoveRequest,
	GetStorageRequest,
	UpdateStorageEvent,
	Item,
} from "./messages";

type IpcItems = [string, number][];

export class InstancePlugin extends BaseInstancePlugin {
	pendingTasks!: Set<any>;
	pingId?: ReturnType<typeof setTimeout>;

	unexpectedError(err: Error) {
		this.logger.error(`Unexpected error:\n${err.stack}`);
	}

	async init() {
		this.pendingTasks = new Set();
		this.instance.server.on("ipc-subspace_storage:output", (output: IpcItems) => {
			this.provideItems(output).catch(err => this.unexpectedError(err));
		});
		this.instance.server.on("ipc-subspace_storage:orders", (orders: IpcItems) => {
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
	async provideItems(items: IpcItems) {
		if (!this.host.connector.hasSession) {
			// For now the items are voided if the controller connection is
			// down, which is no different from the previous behaviour.
			if (this.instance.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose("Voided the following items:");
				this.logger.verbose(JSON.stringify(items));
			}
			return;
		}


		const fromIpcItems = items.map(item => new Item(item[0], item[1]));
		this.instance.sendTo("controller", new PlaceEvent(fromIpcItems));

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Exported the following to controller:");
			this.logger.verbose(JSON.stringify(items));
		}
	}

	// request items --------------------------------------------------------------
	async requestItems(requestItems: IpcItems) {
		// Request the items all at once
		let fromIpcItems = requestItems.map(item => new Item(item[0], item[1]));
		let items = await this.instance.sendTo("controller", new RemoveRequest(fromIpcItems));

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
	async handleUpdateStorageEvent(event: UpdateStorageEvent) {
		if (this.instance.status !== "running") {
			return;
		}
		let items = event.items;

		// XXX this should be moved to instance/clusterio api
		items.push(new Item("signal-unixtime", Math.floor(Date.now()/1000)));

		let itemsJson = lib.escapeString(JSON.stringify(items));
		let task = this.sendRcon(`/sc __subspace_storage__ UpdateInvData("${itemsJson}")`, true);
		this.pendingTasks.add(task);
		await task.finally(() => { this.pendingTasks.delete(task); });
	}
}
