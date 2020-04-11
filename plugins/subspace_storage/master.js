"use strict";
const fs = require("fs-extra");
const path = require("path");

const database = require("lib/database");
const plugin = require("lib/plugin");
const prometheus = require("lib/prometheus");

const routes = require("./routes");
const dole = require("./dole");


const exportCounter = new prometheus.Counter(
	"clusterio_subspace_storage_export_total",
	"Resources exported by instance",
	{ labels: ["instance_id", "resource"] }
);
const importCounter = new prometheus.Counter(
	"clusterio_subspace_storage_import_total",
	"Resources imported by instance",
	{ labels: ["instance_id", "resource"] }
);
const masterInventoryGauge = new prometheus.Gauge(
	"clusterio_subspace_storage_master_inventory",
	"Amount of resources stored on master",
	{ labels: ["resource"] }
);


class MasterPlugin extends plugin.BaseMasterPlugin {
	async init() {

		let root = this.master.config.get("master.web_root");
		this.ui = {
			sidebar: [
				{
					getHtml: () => `
    <div class="nav-item mr-1">
        <a class="nav-link align-middle" href="${root}subspace_storage/storage">Storage</a>
    </div>`,
				},
			],
		};

		this.items = await loadDatabase(this.master.config);
		this.itemsLastUpdate = new Map(this.items._items.entries());
		this.autosaveId = setInterval(() => {
			saveDatabase(this.master.config, this.items).catch(err => {
				console.log("Unexpected error autosaving items in subspace_storage")
				console.log("-----------------------------------------------------")
				console.log(err);
			});
		}, this.master.config.get("subspace_storage.autosave_interval") * 1000);

		this.neuralDole = new dole.neuralDole({ items: this.items });
		this.doleMagicId = setInterval(() => {
			if (this.master.config.get("subspace_storage.division_method") === "neural_dole") {
				this.neuralDole.doMagic()
			}
		}, 1000);

		routes.addApiRoutes(this.master.app, this.items, this.metrics.endpointHitCounter);
		routes.addWebRoutes(this.master.app);
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
		for (let slaveConnection of this.master.slaveConnections.values()) {
			this.info.messages.updateStorage.send(slaveConnection, { items: itemsToUpdate });
		}
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
			console.log(`Imported the following from ${message.data.instance_id}:`)
			console.log(message.data.items);
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
						object: { name: item[0], count: item[1], instanceId, instanceName},
						items: this.items,
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
				console.log(`Exported the following to ${instanceId}`);
				console.log(itemsRemoved);
			}
		}

		return {
			items: itemsRemoved,
		}
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
		await saveDatabase(this.master.config, this.items);
	}
}

async function loadDatabase(config) {
	let itemsPath = path.resolve(config.get("master.database_directory"), "items.json");
	console.log(`Loading ${itemsPath}`);
	try {
		let content = await fs.readFile(itemsPath);
		return new database.ItemDatabase(JSON.parse(content));

	} catch (err) {
		if (err.code === "ENOENT") {
			console.log("Creating new item database");
			return new database.ItemDatabase();

		} else {
			throw err;
		}
	}
}

async function saveDatabase(masterConfig, items) {
	if (items && items.size < 50000) {
		let file = path.resolve(masterConfig.get("master.database_directory"), "items.json");
		console.log(`writing ${file}`);
		let content = JSON.stringify(items.serialize());
		await fs.outputFile(file, content);
	} else if (items) {
		console.error(`Item database too large, not saving (${items.size})`);
	}
}

module.exports = {
	MasterPlugin,
};
