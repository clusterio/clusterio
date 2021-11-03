"use strict";
const fs = require("fs-extra");
const path = require("path");

const libFileOps = require("@clusterio/lib/file_ops");
const libPlugin = require("@clusterio/lib/plugin");
const libErrors = require("@clusterio/lib/errors");

async function loadDatabase(config, logger) {
	let itemsPath = path.resolve(config.get("master.database_directory"), "inventories.json");
	logger.verbose(`Loading ${itemsPath}`);
	try {
		let content = await fs.readFile(itemsPath);
		return new Map(JSON.parse(content));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.verbose("Creating new player data database");
			return new Map();
		}
		throw err;
	}
}

async function saveDatabase(masterConfig, playerDatastore, logger) {
	if (playerDatastore) {
		let file = path.resolve(masterConfig.get("master.database_directory"), "inventories.json");
		logger.verbose(`writing ${file}`);
		let content = JSON.stringify(Array.from(playerDatastore));
		await libFileOps.safeOutputFile(file, content);
	}
}

class MasterPlugin extends libPlugin.BaseMasterPlugin {
	async init() {
		this.acquiredPlayers = new Map();
		this.playerDatastore = await loadDatabase(this.master.config, this.logger);
		this.autosaveId = setInterval(() => {
			saveDatabase(this.master.config, this.playerDatastore, this.logger).catch(err => {
				this.logger.error(`Unexpected error autosaving player data:\n${err.stack}`);
			});
		}, this.master.config.get("inventory_sync.autosave_interval") * 1000);
	}

	async onInstanceStatusChanged(instance) {
		let instanceId = instance.config.get("instance.id");
		if (["unassigned", "deleted"].includes(instance.status)) {
			for (let [playerName, acquisitionRecord] of this.acquiredPlayers) {
				if (acquisitionRecord.instanceId === instanceId) {
					this.acquiredPlayers.delete(playerName);
				}
			}
		}

		if (["unknown", "stopped"].includes(instance.status)) {
			let timeout = this.master.config.get("inventory_sync.player_lock_timeout") * 1000;
			for (let acquisitonRecord of this.acquiredPlayers.values()) {
				if (acquisitonRecord.instanceId === instanceId && !acquisitonRecord.expires) {
					acquisitonRecord.expires = Date.now() + timeout;
				}
			}
		}

		if (instance.status === "running") {
			for (let acquisitonRecord of this.acquiredPlayers.values()) {
				if (acquisitonRecord.instanceId === instanceId && acquisitonRecord.expires) {
					delete acquisitonRecord.expires;
				}
			}
		}
	}

	acquire(instanceId, playerName) {
		let acquisitionRecord = this.acquiredPlayers.get(playerName);
		if (
			!acquisitionRecord
			|| acquisitionRecord.instanceId === instanceId
			|| !this.master.instances.has(acquisitionRecord.instanceId)
			|| acquisitionRecord.expires && acquisitionRecord.expires < Date.now()
		) {
			this.acquiredPlayers.set(playerName, { instanceId });
			return true;
		}

		return false;
	}

	async acquireRequestHandler(message) {
		let { instance_id, player_name } = message.data;
		if (!this.acquire(instance_id, player_name)) {
			let acquisitionRecord = this.acquiredPlayers.get(player_name);
			let instance = this.master.instances.get(acquisitionRecord.instanceId);
			return {
				status: "busy",
				message: instance.config.get("instance.name"),
			};
		}

		let playerData = this.playerDatastore.get(player_name);
		return {
			status: "acquired",
			has_data: Boolean(playerData),
			generation: playerData ? playerData.generation : 0,
		};
	}

	async releaseRequestHandler(message) {
		let { instance_id, player_name } = message.data;
		let acquisitionRecord = this.acquiredPlayers.get(player_name);
		if (!acquisitionRecord) {
			return;
		}

		if (acquisitionRecord.instanceId === instance_id) {
			this.acquiredPlayers.delete(player_name);
		}
	}

	async uploadRequestHandler(message) {
		let { instance_id, player_name, player_data } = message.data;
		let instanceName = this.master.instances.get(instance_id).config.get("instance.name");
		let store = true;
		let acquisitionRecord = this.acquiredPlayers.get(player_name);
		if (!acquisitionRecord) {
			this.logger.warn(`${instanceName} uploaded ${player_name} without an acquisition`);
			// Allow upload in this case as it might come from a crashed instance that restarted and is now
			// uploading the player data for all the players that were online during the last autosave.

		} else if (acquisitionRecord.instanceId !== instance_id) {
			this.logger.warn(`${instanceName} uploaded ${player_name} while another instance has acquired it`);
			store = false;

		} else {
			this.acquiredPlayers.delete(player_name);
		}

		this.acquiredPlayers.delete(player_name);
		let oldPlayerData = this.playerDatastore.get(player_name);
		if (store && oldPlayerData && oldPlayerData.generation >= player_data.generation) {
			this.logger.warn(
				`${instanceName} uploaded generation ${player_data.generation} while the stored` +
				`generation is ${oldPlayerData.generation} for ${player_name}`
			);
			store = false;
		}

		if (store) {
			this.logger.verbose(`Received player data for ${player_name} from ${instanceName}`);
			this.playerDatastore.set(player_name, player_data);
		}
	}

	async downloadRequestHandler(message) {
		let { instance_id, player_name } = message.data;
		let instanceName = this.master.instances.get(instance_id).config.get("instance.name");

		let acquisitionRecord = this.acquiredPlayers.get(player_name);
		if (!acquisitionRecord) {
			this.logger.warn(`${instanceName} downloaded ${player_name} without an acquisition`);
		} else if (acquisitionRecord.instanceId !== instance_id) {
			this.logger.warn(`${instanceName} downloaded ${player_name} while another instance has acquired it`);
		}

		this.logger.verbose(`Sending player data for ${player_name} to ${instanceName}`);
		return {
			player_data: this.playerDatastore.get(player_name) || null,
		};
	}

	async onShutdown() {
		clearInterval(this.autosaveId);
		await saveDatabase(this.master.config, this.playerDatastore, this.logger);
	}

	async databaseStatsRequestHandler(message) {
		let playerDatastore = Array.from(this.playerDatastore.keys())
			.map(name => ({
				name,
				length: JSON.stringify(this.playerDatastore.get(name)).length,
			}))
			.sort((a, b) => a.length - b.length);
		return {
			database_size: playerDatastore.map(x => x.length).reduce((a, b) => b - a, 0),
			database_entries: playerDatastore.length,
			largest_entry: {
				name: playerDatastore[0] && playerDatastore[0].name || "-",
				size: playerDatastore[0] && playerDatastore[0].length || 0,
			},
		};
	}
}

module.exports = {
	MasterPlugin,
};
