"use strict";
const fs = require("fs-extra");
const path = require("path");

const libPlugin = require("@clusterio/lib/plugin");

async function loadDatabase(config, logger) {
	let itemsPath = path.resolve(config.get("master.database_directory"), "inventories.json");
	logger.verbose(`Loading ${itemsPath}`);
	try {
		let content = await fs.readFile(itemsPath);
		return JSON.parse(content);

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.verbose("Creating new inventory database");
			return {};
		}
		throw err;
	}
}

async function saveDatabase(masterConfig, inventories, logger) {
	if (inventories) {
		let file = path.resolve(masterConfig.get("master.database_directory"), "inventories.json");
		logger.verbose(`writing ${file}`);
		let content = JSON.stringify(inventories);
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
		this.inventories[message.data.player_name] = message.data.inventory;

		return { success: true };
	}

	async downloadRequestHandler(message) {
		this.logger.verbose(`Downloading inventory for ${message.data.player_name}`);
		return {
			player_name: message.data.player_name,
			inventory: this.inventories[message.data.player_name] || {},
			new_player: !this.inventories[message.data.player_name],
		};
	}

	async onShutdown() {
		clearInterval(this.autosaveId);
		await saveDatabase(this.master.config, this.inventories, this.logger);
	}

	async databaseStatsRequestHandler(message) {
		let inventories = Object.keys(this.inventories)
			.map(name => ({
				name,
				length: JSON.stringify(this.inventories[name]).length,
			}))
			.sort((a, b) => a.stringified.length - b.stringified.length);
		return {
			database_size: inventories.map(x => x.length).reduce((a, b) => b - a, 0),
			database_entries: inventories.length,
			largest_entry: {
				name: inventories[0].name,
				size: inventories[0].length,
			},
		};
	}
}

module.exports = {
	MasterPlugin,
};
