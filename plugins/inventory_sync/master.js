"use strict";
const fs = require("fs-extra");
const path = require("path");

const libPlugin = require("@clusterio/lib/plugin");

async function loadDatabase(config, logger) {
	let itemsPath = path.resolve(config.get("master.database_directory"), "inventories.json");
	logger.verbose(`Loading ${itemsPath}`);
	try {
		let content = await fs.readFile(itemsPath);
		return new Map(JSON.parse(content));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.verbose("Creating new inventory database");
			return new Map();
		}
		throw err;
	}
}

async function saveDatabase(masterConfig, inventories, logger) {
	if (inventories) {
		let file = path.resolve(masterConfig.get("master.database_directory"), "inventories.json");
		logger.verbose(`writing ${file}`);
		let content = JSON.stringify(Array.from(inventories));
		await fs.outputFile(file, content);
	}
}

class MasterPlugin extends libPlugin.BaseMasterPlugin {
	async init() {
		this.inventories = await loadDatabase(this.master.config, this.logger);
		this.autosaveId = setInterval(() => {
			saveDatabase(this.master.config, this.inventories, this.logger).catch(err => {
				this.logger.error(`Unexpected error autosaving inventories:\n${err.stack}`);
			});
		}, this.master.config.get("inventory_sync.autosave_interval") * 1000);
	}

	async uploadRequestHandler(message) {
		this.logger.verbose(`Saving inventory for ${message.data.player_name}`);
		this.inventories.set(message.data.player_name, message.data.inventory);
	}

	async downloadRequestHandler(message) {
		this.logger.verbose(`Downloading inventory for ${message.data.player_name}`);
		let inventory = this.inventories.get(message.data.player_name);
		return {
			player_name: message.data.player_name,
			inventory: inventory || {},
			new_player: !inventory,
		};
	}

	async onShutdown() {
		clearInterval(this.autosaveId);
		await saveDatabase(this.master.config, this.inventories, this.logger);
	}

	async databaseStatsRequestHandler(message) {
		let inventories = Array.from(this.inventories.keys())
			.map(name => ({
				name,
				length: JSON.stringify(this.inventories.get(name)).length,
			}))
			.sort((a, b) => a.stringified.length - b.stringified.length);
		return {
			database_size: inventories.map(x => x.length).reduce((a, b) => b - a, 0),
			database_entries: inventories.length,
			largest_entry: {
				name: inventories[0] && inventories[0].name || "-",
				size: inventories[0] && inventories[0].length || 0,
			},
		};
	}
}

module.exports = {
	MasterPlugin,
};
