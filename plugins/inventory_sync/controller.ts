import type InstanceInfo from "@clusterio/controller/src/InstanceInfo";
import type Controller from "@clusterio/controller/src/Controller";
import type { IpcPlayerData } from "./instance";

import fs from "fs-extra";
import path from "path";
import * as lib from "@clusterio/lib";
import * as msg from "./messages";

async function loadDatabase(config: lib.ControllerConfig, logger: lib.Logger) {
	let itemsPath = path.resolve(config.get("controller.database_directory"), "inventories.json");
	logger.verbose(`Loading ${itemsPath}`);
	try {
		let content = await fs.readFile(itemsPath, { encoding: "utf8" });
		return new Map(JSON.parse(content));

	} catch (err: any) {
		if (err.code === "ENOENT") {
			logger.verbose("Creating new player data database");
			return new Map();
		}
		throw err;
	}
}

async function saveDatabase(
	controllerConfig: lib.ControllerConfig,
	playerDatastore: Map<string, IpcPlayerData>,
	logger: lib.Logger,
) {
	if (playerDatastore) {
		let file = path.resolve(controllerConfig.get("controller.database_directory"), "inventories.json");
		logger.verbose(`writing ${file}`);
		let content = JSON.stringify(Array.from(playerDatastore));
		await lib.safeOutputFile(file, content);
	}
}

export class ControllerPlugin extends lib.BaseControllerPlugin {
	acquiredPlayers!: Map<string, { instanceId: number, expires?: number }>;
	playerDatastore!: Map<string, IpcPlayerData>;
	autosaveId!: ReturnType<typeof setInterval>;

	async init() {
		this.acquiredPlayers = new Map();
		this.playerDatastore = await loadDatabase(this.controller.config, this.logger);
		this.autosaveId = setInterval(() => {
			saveDatabase(this.controller.config, this.playerDatastore, this.logger).catch(err => {
				this.logger.error(`Unexpected error autosaving player data:\n${err.stack}`);
			});
		}, this.controller.config.get("inventory_sync.autosave_interval") * 1000);

		this.controller.handle(msg.AcquireRequest, this.handleAcquireRequest.bind(this));
		this.controller.handle(msg.ReleaseRequest, this.handleReleaseRequest.bind(this));
		this.controller.handle(msg.UploadRequest, this.handleUploadRequest.bind(this));
		this.controller.handle(msg.DownloadRequest, this.handleDownloadRequest.bind(this));
		this.controller.handle(msg.DatabaseStatsRequest, this.handleDatabaseStatsRequest.bind(this));
	}

	async onInstanceStatusChanged(instance: InstanceInfo) {
		let instanceId = instance.id;
		if (["unassigned", "deleted"].includes(instance.status)) {
			for (let [playerName, acquisitionRecord] of this.acquiredPlayers) {
				if (acquisitionRecord.instanceId === instanceId) {
					this.acquiredPlayers.delete(playerName);
				}
			}
		}

		if (["unknown", "stopped"].includes(instance.status)) {
			let timeout = this.controller.config.get("inventory_sync.player_lock_timeout") * 1000;
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

	acquire(instanceId: number, playerName: string): boolean {
		let acquisitionRecord = this.acquiredPlayers.get(playerName);
		if (
			!acquisitionRecord
			|| acquisitionRecord.instanceId === instanceId
			|| !this.controller.instances.has(acquisitionRecord.instanceId)
			|| acquisitionRecord.expires && acquisitionRecord.expires < Date.now()
		) {
			this.acquiredPlayers.set(playerName, { instanceId });
			return true;
		}

		return false;
	}

	async handleAcquireRequest(request: msg.AcquireRequest) {
		let { instanceId, playerName } = request;
		if (!this.acquire(instanceId, playerName)) {
			let acquisitionRecord = this.acquiredPlayers.get(playerName);
			let instance = this.controller.instances.get(acquisitionRecord!.instanceId);
			return {
				status: "busy",
				message: instance.config.get("instance.name"),
			};
		}

		let playerData = this.playerDatastore.get(playerName);
		return new msg.AcquireRequest.Response(
			"acquired",
			playerData ? playerData.generation : 0,
			Boolean(playerData),
		);
	}

	async handleReleaseRequest(request: msg.ReleaseRequest) {
		let { instanceId, playerName } = request;
		let acquisitionRecord = this.acquiredPlayers.get(playerName);
		if (!acquisitionRecord) {
			return;
		}

		if (acquisitionRecord.instanceId === instanceId) {
			this.acquiredPlayers.delete(playerName);
		}
	}

	async handleUploadRequest(request: msg.UploadRequest) {
		let { instanceId, playerName, playerData } = request;
		let instanceName = this.controller.instances.get(instanceId).config.get("instance.name");
		let store = true;
		let acquisitionRecord = this.acquiredPlayers.get(playerName);
		if (!acquisitionRecord) {
			this.logger.warn(`${instanceName} uploaded ${playerName} without an acquisition`);
			// Allow upload in this case as it might come from a crashed instance that restarted and is now
			// uploading the player data for all the players that were online during the last autosave.

		} else if (acquisitionRecord.instanceId !== instanceId) {
			this.logger.warn(`${instanceName} uploaded ${playerName} while another instance has acquired it`);
			store = false;

		} else {
			this.acquiredPlayers.delete(playerName);
		}

		this.acquiredPlayers.delete(playerName);
		let oldPlayerData = this.playerDatastore.get(playerName);
		if (store && oldPlayerData && oldPlayerData.generation >= playerData.generation) {
			this.logger.warn(
				`${instanceName} uploaded generation ${playerData.generation} while the stored` +
				`generation is ${oldPlayerData.generation} for ${playerName}`
			);
			store = false;
		}

		if (store) {
			this.logger.verbose(`Received player data for ${playerName} from ${instanceName}`);
			this.playerDatastore.set(playerName, playerData);
		}
	}

	async handleDownloadRequest(request: msg.DownloadRequest) {
		let { instanceId, playerName } = request;
		let instanceName = this.controller.instances.get(instanceId).config.get("instance.name");

		let acquisitionRecord = this.acquiredPlayers.get(playerName);
		if (!acquisitionRecord) {
			this.logger.warn(`${instanceName} downloaded ${playerName} without an acquisition`);
		} else if (acquisitionRecord.instanceId !== instanceId) {
			this.logger.warn(`${instanceName} downloaded ${playerName} while another instance has acquired it`);
		}

		this.logger.verbose(`Sending player data for ${playerName} to ${instanceName}`);
		return new msg.DownloadRequest.Response(this.playerDatastore.get(playerName) || null);
	}

	async onShutdown() {
		clearInterval(this.autosaveId);
		await saveDatabase(this.controller.config, this.playerDatastore, this.logger);
	}

	async handleDatabaseStatsRequest() {
		let playerDatastore = Array.from(this.playerDatastore.keys())
			.map(name => ({
				name,
				length: JSON.stringify(this.playerDatastore.get(name)).length,
			}))
			.sort((a, b) => b.length - a.length);
		return new msg.DatabaseStatsRequest.Response(
			playerDatastore.map(x => x.length).reduce((a, b) => b - a, 0),
			playerDatastore.length,
			{
				name: playerDatastore[0] && playerDatastore[0].name || "-",
				size: playerDatastore[0] && playerDatastore[0].length || 0,
			},
		);
	}
}
