"use strict";
const fs = require("fs-extra");
const path = require("path");

const libDatabase = require("@clusterio/lib/database");
const libFileOps = require("@clusterio/lib/file_ops");
const libPlugin = require("@clusterio/lib/plugin");
const { Counter, Gauge } = require("@clusterio/lib/prometheus");
const RateLimiter = require("@clusterio/lib/RateLimiter");

const routes = require("./routes");
const dole = require("./dole");

const {
	Item,
	PlaceEvent,
	RemoveRequest,
	GetStorageRequest,
	UpdateStorageEvent,
	SetStorageSubscriptionRequest,
} = require("./messages");


const exportCounter = new Counter(
	"clusterio_subspace_storage_export_total",
	"Resources exported by instance",
	{ labels: ["instance_id", "resource"] }
);
const importCounter = new Counter(
	"clusterio_subspace_storage_import_total",
	"Resources imported by instance",
	{ labels: ["instance_id", "resource"] }
);
const controllerInventoryGauge = new Gauge(
	"clusterio_subspace_storage_controller_inventory",
	"Amount of resources stored on controller",
	{ labels: ["resource"] }
);


async function loadDatabase(config, logger) {
	let itemsPath = path.resolve(config.get("controller.database_directory"), "items.json");
	logger.verbose(`Loading ${itemsPath}`);
	try {
		let content = await fs.readFile(itemsPath);
		return new libDatabase.ItemDatabase(JSON.parse(content));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.verbose("Creating new item database");
			return new libDatabase.ItemDatabase();
		}
		throw err;
	}
}

async function saveDatabase(controllerConfig, items, logger) {
	if (items && items.size < 50000) {
		let file = path.resolve(controllerConfig.get("controller.database_directory"), "items.json");
		logger.verbose(`writing ${file}`);
		let content = JSON.stringify(items.serialize());
		await libFileOps.safeOutputFile(file, content);
	} else if (items) {
		logger.error(`Item database too large, not saving (${items.size})`);
	}
}

class ControllerPlugin extends libPlugin.BaseControllerPlugin {
	async init() {

		this.items = await loadDatabase(this.controller.config, this.logger);
		this.itemUpdateRateLimiter = new RateLimiter({
			maxRate: 1,
			action: () => {
				try {
					this.broadcastStorage();
				} catch (err) {
					this.logger.error(`Unexpected error sending storage update:\n${err.stack}`);
				}
			},
		});
		this.itemsLastUpdate = new Map(this.items._items.entries());
		this.autosaveId = setInterval(() => {
			saveDatabase(this.controller.config, this.items, this.logger).catch(err => {
				this.logger.error(`Unexpected error autosaving items:\n${err.stack}`);
			});
		}, this.controller.config.get("subspace_storage.autosave_interval") * 1000);

		this.neuralDole = new dole.NeuralDole({ items: this.items });
		this.doleMagicId = setInterval(() => {
			if (this.controller.config.get("subspace_storage.division_method") === "neural_dole") {
				this.neuralDole.doMagic();
			}
		}, 1000);

		this.subscribedControlLinks = new Set();

		routes.addApiRoutes(this.controller.app, this.items);

		this.controller.register(GetStorageRequest, this.handleGetStorageRequest.bind(this));
		this.controller.register(PlaceEvent, this.handlePlaceEvent.bind(this));
		this.controller.register(RemoveRequest, this.handleRemoveRequest.bind(this));
		this.controller.register(SetStorageSubscriptionRequest, this.handleSetStorageSubscriptionRequest.bind(this));
	}

	updateStorage() {
		this.itemUpdateRateLimiter.activate();
	}

	broadcastStorage() {
		let itemsToUpdate = new Map();
		for (let [name, count] of this.items._items) {
			if (this.itemsLastUpdate.get(name) === count) {
				continue;
			}
			itemsToUpdate.set(name, count);
		}

		if (!itemsToUpdate.size) {
			return;
		}

		itemsToUpdate = [...itemsToUpdate.entries()];
		let update = new UpdateStorageEvent(itemsToUpdate);
		this.controller.sendTo(update, "allInstances");
		for (let link of this.subscribedControlLinks) {
			link.send(update);
		}
		this.itemsLastUpdate = new Map(this.items._items.entries());
	}

	async handleGetStorageRequest() {
		return [...this.items._items.entries()];
	}

	async handlePlaceEvent(request, src) {
		let instanceId = src.id;

		for (let item of request.items) {
			this.items.addItem(item.name, item.count);
			exportCounter.labels(String(instanceId), item.name).inc(item.count);
		}

		this.updateStorage();

		if (this.controller.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose(
				`Imported the following from ${instanceId}:\n${JSON.stringify(request.items)}`
			);
		}
	}

	async handleRemoveRequest(request, src) {
		let method = this.controller.config.get("subspace_storage.division_method");
		let instanceId = src.id;

		let itemsRemoved = [];
		if (method === "simple") {
			// Give out as much items as possible until there are 0 left.  This
			// might lead to one host getting all the items and the rest nothing.
			for (let item of request.items) {
				let count = this.items.getItemCount(item.name);
				let toRemove = Math.min(count, item.count);
				if (toRemove > 0) {
					this.items.removeItem(item.name, toRemove);
					itemsRemoved.push(new Item(item.name, toRemove));
				}
			}

		} else {
			let instance = this.controller.instances.get(instanceId);
			let instanceName = instance ? instance.config.get("instance.name") : "unkonwn";

			// use fancy neural net to calculate a "fair" dole division rate.
			if (method === "neural_dole") {
				for (let item of request.items) {
					let count = neuralDole.divider({ name: item.name, count: item.count, instanceId, instanceName });
					if (count > 0) {
						itemsRemoved.push(new Item(item.name, count));
					}
				}

			// Use dole division. Makes it really slow to drain out the last little bit.
			} else if (method === "dole") {
				for (let item of request.items) {
					let count = dole.doleDivider({
						object: { name: item.name, count: item.count, instanceId, instanceName },
						items: this.items,
						logItemTransfers: this.controller.config.get("subspace_storage.log_item_transfers"),
						logger: this.logger,
					});
					if (count > 0) {
						itemsRemoved.push(new Item(item.name, count));
					}
				}

			// Should not be possible
			} else {
				throw Error(`Unkown division_method ${method}`);
			}
		}

		if (itemsRemoved.length) {
			for (let item of itemsRemoved) {
				importCounter.labels(String(instanceId), item.name).inc(item.count);
			}

			this.updateStorage();

			if (itemsRemoved.length && this.controller.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose(`Exported the following to ${instanceId}:\n${JSON.stringify(itemsRemoved)}`);
			}
		}

		return itemsRemoved;
	}

	async handleSetStorageSubscriptionRequest(request, src) {
		let link = this.controller.wsServer.controlConnections.get(src.id);
		if (request.storage) {
			this.subscribedControlLinks.add(link);
		} else {
			this.subscribedControlLinks.delete(link);
		}
	}

	onControlConnectionEvent(connection, event) {
		if (event === "close") {
			this.subscribedControlLinks.delete(connection);
		}
	}

	onMetrics() {
		if (this.items) {
			for (let [key, count] of this.items._items) {
				controllerInventoryGauge.labels(key).set(Number(count) || 0);
			}
		}
	}

	async onShutdown() {
		this.itemUpdateRateLimiter.cancel();
		clearInterval(this.autosaveId);
		clearInterval(this.doleMagicId);
		await saveDatabase(this.controller.config, this.items, this.logger);
	}
}

module.exports = {
	ControllerPlugin,
};
