"use strict";
const fs = require("fs-extra");
const path = require("path");

const libDatabase = require("@clusterio/lib/database");
const libPlugin = require("@clusterio/lib/plugin");
const { Counter, Gauge } = require("@clusterio/lib/prometheus");

const routes = require("./routes");
const dole = require("./dole");


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
const masterInventoryGauge = new Gauge(
	"clusterio_subspace_storage_master_inventory",
	"Amount of resources stored on master",
	{ labels: ["resource"] }
);


async function loadDatabase(config, logger) {
	let itemsPath = path.resolve(config.get("master.database_directory"), "items.json");
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

async function saveDatabase(masterConfig, items, logger) {
	if (items && items.size < 50000) {
		let file = path.resolve(masterConfig.get("master.database_directory"), "items.json");
		logger.verbose(`writing ${file}`);
		let content = JSON.stringify(items.serialize());
		await fs.outputFile(file, content);
	} else if (items) {
		logger.error(`Item database too large, not saving (${items.size})`);
	}
}

class MasterPlugin extends libPlugin.BaseMasterPlugin {
	async init() {

		this.items = await loadDatabase(this.master.config, this.logger);
		this.itemsLastUpdate = new Map(this.items._items.entries());
		this.autosaveId = setInterval(() => {
			saveDatabase(this.master.config, this.items, this.logger).catch(err => {
				this.logger.error(`Unexpected error autosaving items:\n${err.stack}`);
			});
		}, this.master.config.get("subspace_storage.autosave_interval") * 1000);

		this.neuralDole = new dole.NeuralDole({ items: this.items });
		this.doleMagicId = setInterval(() => {
			if (this.master.config.get("subspace_storage.division_method") === "neural_dole") {
				this.neuralDole.doMagic();
			}
		}, 1000);

		routes.addApiRoutes(this.master.app, this.items, this.metrics.endpointHitCounter);
	}

	updateStorage() {
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
		this.broadcastEventToSlaves(this.info.messages.updateStorage, { items: itemsToUpdate });
		this.itemsLastUpdate = new Map(this.items._items.entries());
	}

	async getStorageRequestHandler(message) {
		return { items: [...this.items._items.entries()] };
	}

	async placeEventHandler(message) {
		let instanceId = message.data.instance_id;

		for (let item of message.data.items) {
			this.items.addItem(item[0], item[1]);
			exportCounter.labels(String(instanceId), item[0]).inc(item[1]);
		}

		this.updateStorage();

		if (this.master.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose(
				`Imported the following from ${message.data.instance_id}:\n${JSON.stringify(message.data.items)}`
			);
		}
	}

	async removeRequestHandler(message) {
		let method = this.master.config.get("subspace_storage.division_method");
		let instanceId = message.data.instance_id;

		let itemsRemoved = [];
		if (method === "simple") {
			// Give out as much items as possible until there are 0 left.  This
			// might lead to one slave getting all the items and the rest nothing.
			for (let item of message.data.items) {
				let count = this.items.getItemCount(item[0]);
				let toRemove = Math.min(count, item[1]);
				if (toRemove > 0) {
					this.items.removeItem(item[0], toRemove);
					itemsRemoved.push([item[0], toRemove]);
				}
			}

		} else {
			let instanceConfig = this.master.db.instances.get(instanceId);
			let instanceName = instanceConfig ? instanceConfig.get("instance.name") : "unkonwn";

			// use fancy neural net to calculate a "fair" dole division rate.
			if (method === "neural_dole") {
				for (let item of message.data.items) {
					let count = neuralDole.divider({ name: item[0], count: item[1], instanceId, instanceName });
					if (count > 0) {
						itemsRemoved.push([item[0], count]);
					}
				}

			// Use dole division. Makes it really slow to drain out the last little bit.
			} else if (method === "dole") {
				for (let item of message.data.items) {
					let count = dole.doleDivider({
						object: { name: item[0], count: item[1], instanceId, instanceName },
						items: this.items,
						logItemTransfers: this.master.config.get("subspace_storage.log_item_transfers"),
						logger: this.logger,
					});
					if (count > 0) {
						itemsRemoved.push([item[0], count]);
					}
				}

			// Should not be possible
			} else {
				throw Error(`Unkown division_method ${method}`);
			}
		}

		if (itemsRemoved.length) {
			for (let item of itemsRemoved) {
				importCounter.labels(String(instanceId), item[0]).inc(item[1]);
			}

			this.updateStorage();

			if (itemsRemoved.length && this.master.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose(`Exported the following to ${instanceId}:\n${JSON.stringify(itemsRemoved)}`);
			}
		}

		return {
			items: itemsRemoved,
		};
	}

	onMetrics() {
		if (this.items) {
			for (let [key, count] of this.items._items) {
				masterInventoryGauge.labels(key).set(Number(count) || 0);
			}
		}
	}

	async onShutdown() {
		clearInterval(this.autosaveId);
		clearInterval(this.doleMagicId);
		await saveDatabase(this.master.config, this.items, this.logger);
	}
}

module.exports = {
	MasterPlugin,
};
