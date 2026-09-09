import { BaseControllerPlugin, type InstanceRecord } from "@clusterio/controller";
import type { IpcPlayerData } from "./messages";

import fs from "node:fs/promises";
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
	playerDatastore: Map<string, IpcPlayerData> | undefined,
	logger: lib.Logger,
) {
	if (playerDatastore) {
		let file = path.resolve(controllerConfig.get("controller.database_directory"), "inventories.json");
		logger.verbose(`writing ${file}`);
		let content = JSON.stringify(Array.from(playerDatastore));
		await lib.safeOutputFile(file, content);
	}
}

export class ControllerPlugin extends BaseControllerPlugin {
	acquiredPlayers!: Map<string, { instanceId: number, expiresMs?: number }>;
	playerDatastore!: Map<string, IpcPlayerData>;
	playerDatastoreDirty = false;

	async init() {
		this.acquiredPlayers = new Map();
		this.playerDatastore = await loadDatabase(this.controller.config, this.logger);

		this.controller.handle(msg.AcquireRequest, this.handleAcquireRequest.bind(this));
		this.controller.handle(msg.ReleaseRequest, this.handleReleaseRequest.bind(this));
		this.controller.handle(msg.UploadRequest, this.handleUploadRequest.bind(this));
		this.controller.handle(msg.DownloadRequest, this.handleDownloadRequest.bind(this));
		this.controller.handle(msg.DatabaseStatsRequest, this.handleDatabaseStatsRequest.bind(this));
		this.controller.handle(msg.ListPlayersRequest, this.handleListPlayersRequest.bind(this));
		this.controller.handle(msg.GetPlayerDataRequest, this.handleGetPlayerDataRequest.bind(this));
		this.controller.handle(msg.SetPlayerDataRequest, this.handleSetPlayerDataRequest.bind(this));
		this.controller.handle(msg.DeletePlayerDataRequest, this.handleDeletePlayerDataRequest.bind(this));
		this.controller.handle(msg.ForceReleaseRequest, this.handleForceReleaseRequest.bind(this));
	}

	async onInstanceStatusChanged(instance: InstanceRecord) {
		let instanceId = instance.id;
		if (["unassigned", "deleted"].includes(instance.status)) {
			for (let [playerName, acquisitionRecord] of this.acquiredPlayers) {
				if (acquisitionRecord.instanceId === instanceId) {
					this.acquiredPlayers.delete(playerName);
				}
			}
		}

		if (["unknown", "stopped"].includes(instance.status)) {
			let timeoutMs = this.controller.config.get("inventory_sync.player_lock_timeout") * 1000;
			for (let acquisitonRecord of this.acquiredPlayers.values()) {
				if (acquisitonRecord.instanceId === instanceId && !acquisitonRecord.expiresMs) {
					acquisitonRecord.expiresMs = Date.now() + timeoutMs;
				}
			}
		}

		if (instance.status === "running") {
			for (let acquisitonRecord of this.acquiredPlayers.values()) {
				if (acquisitonRecord.instanceId === instanceId && acquisitonRecord.expiresMs) {
					delete acquisitonRecord.expiresMs;
				}
			}
		}
	}

	// Returns the acquisition record for the player if it's still in effect
	getAcquisition(playerName: string) {
		let acquisitionRecord = this.acquiredPlayers.get(playerName);
		if (
			!acquisitionRecord
			|| !this.controller.instances.has(acquisitionRecord.instanceId)
			|| acquisitionRecord.expiresMs && acquisitionRecord.expiresMs < Date.now()
		) {
			return undefined;
		}
		return acquisitionRecord;
	}

	acquire(instanceId: number, playerName: string): boolean {
		let acquisitionRecord = this.getAcquisition(playerName);
		if (!acquisitionRecord || acquisitionRecord.instanceId === instanceId) {
			this.acquiredPlayers.set(playerName, { instanceId });
			return true;
		}

		return false;
	}

	async handleAcquireRequest(request: msg.AcquireRequest) {
		let { instanceId, playerName } = request;
		if (!this.acquire(instanceId, playerName)) {
			let acquisitionRecord = this.acquiredPlayers.get(playerName);
			let instance = this.controller.instances.get(acquisitionRecord!.instanceId)!;
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
		let instanceName = this.controller.instances.get(instanceId)!.config.get("instance.name");
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
			this.playerDatastoreDirty = true;
		}
	}

	async handleDownloadRequest(request: msg.DownloadRequest) {
		let { instanceId, playerName } = request;
		let instanceName = this.controller.instances.get(instanceId)!.config.get("instance.name");

		let acquisitionRecord = this.acquiredPlayers.get(playerName);
		if (!acquisitionRecord) {
			this.logger.warn(`${instanceName} downloaded ${playerName} without an acquisition`);
		} else if (acquisitionRecord.instanceId !== instanceId) {
			this.logger.warn(`${instanceName} downloaded ${playerName} while another instance has acquired it`);
		}

		this.logger.verbose(`Sending player data for ${playerName} to ${instanceName}`);
		return new msg.DownloadRequest.Response(this.playerDatastore.get(playerName) || null);
	}

	async onSaveData() {
		if (this.playerDatastoreDirty) {
			this.playerDatastoreDirty = false;
			await saveDatabase(this.controller.config, this.playerDatastore, this.logger);
		}
	}

	async handleDatabaseStatsRequest() {
		let playerDatastore = Array.from(this.playerDatastore.keys())
			.map(name => ({
				name,
				length: JSON.stringify(this.playerDatastore.get(name)).length,
			}))
			.sort((a, b) => b.length - a.length);
		return new msg.DatabaseStatsRequest.Response(
			playerDatastore.map(x => x.length).reduce((acc, val) => acc + val, 0),
			playerDatastore.length,
			{
				name: playerDatastore[0] && playerDatastore[0].name || "-",
				size: playerDatastore[0] && playerDatastore[0].length || 0,
			},
		);
	}

	async handleListPlayersRequest() {
		let entries = new Map<string, msg.PlayerEntry>();
		for (let [name, playerData] of this.playerDatastore) {
			entries.set(name, new msg.PlayerEntry(name, playerData.generation, JSON.stringify(playerData).length));
		}
		for (let name of this.acquiredPlayers.keys()) {
			let acquisitionRecord = this.getAcquisition(name);
			if (!acquisitionRecord) {
				continue;
			}
			let entry = entries.get(name) ?? new msg.PlayerEntry(name);
			entry.instanceId = acquisitionRecord.instanceId;
			entries.set(name, entry);
		}
		return [...entries.values()];
	}

	async handleGetPlayerDataRequest(request: msg.GetPlayerDataRequest) {
		let { playerName } = request;
		return new msg.GetPlayerDataRequest.Response(
			this.playerDatastore.get(playerName) ?? null,
			this.getAcquisition(playerName)?.instanceId,
		);
	}

	// Modifying stored data while an instance holds the player is pointless
	// as the instance uploads its own copy when the player leaves.
	checkNotAcquired(playerName: string) {
		let acquisitionRecord = this.getAcquisition(playerName);
		if (acquisitionRecord) {
			let instanceName = this.controller.instances.get(acquisitionRecord.instanceId)!.config.get("instance.name");
			throw new lib.RequestError(
				`${playerName} is currently acquired by ${instanceName}, ` +
				"have the player leave or release the lock first"
			);
		}
	}

	async handleSetPlayerDataRequest(request: msg.SetPlayerDataRequest) {
		let { playerName, playerData } = request;
		this.checkNotAcquired(playerName);

		// Bump the generation so instances holding an older copy download this one
		let oldPlayerData = this.playerDatastore.get(playerName);
		playerData.name = playerName;
		playerData.generation = Math.max(playerData.generation, (oldPlayerData?.generation ?? 0) + 1);
		this.playerDatastore.set(playerName, playerData);
		this.playerDatastoreDirty = true;
		this.logger.info(`Replaced player data for ${playerName} with generation ${playerData.generation}`);
		return new msg.SetPlayerDataRequest.Response(playerData.generation);
	}

	async handleDeletePlayerDataRequest(request: msg.DeletePlayerDataRequest) {
		let { playerName } = request;
		if (!this.playerDatastore.has(playerName)) {
			throw new lib.RequestError(`No player data stored for ${playerName}`);
		}
		this.checkNotAcquired(playerName);

		this.playerDatastore.delete(playerName);
		this.playerDatastoreDirty = true;
		this.logger.info(`Deleted player data for ${playerName}`);
	}

	async handleForceReleaseRequest(request: msg.ForceReleaseRequest) {
		let { playerName } = request;
		if (!this.acquiredPlayers.delete(playerName)) {
			throw new lib.RequestError(`${playerName} is not acquired by any instance`);
		}
		this.logger.info(`Released lock on ${playerName}`);
	}
}
