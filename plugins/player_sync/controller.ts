import type { ControllerPluginContext, InstanceRecord } from "@clusterio/controller";
import type { IpcPlayerData } from "./messages.js";
import { mergePlayerData } from "./components.js";

import fs from "node:fs/promises";
import path from "path";
import * as lib from "@clusterio/lib";
import * as msg from "./messages.js";

// Left behind by deleted player data so instances can tell their copy is stale
type Tombstone = { generation: number, epoch: number, deleted: true };

async function loadDatabase(config: lib.ControllerConfig, logger: lib.Logger) {
	let databaseDirectory = config.get("controller.database_directory");
	let itemsPath = path.resolve(databaseDirectory, "player_sync.json");
	// migrate: inventory_sync stored its data in inventories.json before alpha 28
	let legacyPath = path.resolve(databaseDirectory, "inventories.json");
	if (!await fs.access(itemsPath).then(() => true, () => false)) {
		try {
			await fs.rename(legacyPath, itemsPath);
			logger.info(`Moved ${legacyPath} to ${itemsPath}`);
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}
		}
	}
	let entries: [string, IpcPlayerData | Tombstone][] = [];
	logger.verbose(`Loading ${itemsPath}`);
	try {
		let content = await fs.readFile(itemsPath, { encoding: "utf8" });
		entries = JSON.parse(content);

	} catch (err: any) {
		if (err.code !== "ENOENT") {
			throw err;
		}
		logger.verbose("Creating new player data database");
	}

	let playerDatastore = new Map<string, IpcPlayerData>();
	let tombstones = new Map<string, Tombstone>();
	for (let [name, entry] of entries) {
		if ("deleted" in entry) {
			tombstones.set(name, entry);
		} else {
			playerDatastore.set(name, entry);
		}
	}
	return { playerDatastore, tombstones };
}

// Tombstones share the file with the player data so a delete is written in one go
async function saveDatabase(
	controllerConfig: lib.ControllerConfig,
	playerDatastore: Map<string, IpcPlayerData>,
	tombstones: Map<string, Tombstone>,
	logger: lib.Logger,
) {
	let file = path.resolve(controllerConfig.get("controller.database_directory"), "player_sync.json");
	logger.verbose(`writing ${file}`);
	let content = JSON.stringify([...playerDatastore, ...tombstones]);
	await lib.safeOutputFile(file, content);
}

export default async function(context: ControllerPluginContext) {
	const { controller, logger, plugin } = context;
	const acquiredPlayers = new Map<string, { instanceId: number, expiresMs?: number }>();
	const { playerDatastore, tombstones } = await loadDatabase(controller.config, logger);
	let playerDatastoreDirty = false;

	// Generation and epoch instances should compare their copy against
	function storedVersion(playerName: string) {
		let stored = playerDatastore.get(playerName) ?? tombstones.get(playerName);
		return { generation: stored?.generation ?? 0, epoch: stored?.epoch ?? 0 };
	}

	// Returns the acquisition record for the player if it's still in effect
	function getAcquisition(playerName: string) {
		let acquisitionRecord = acquiredPlayers.get(playerName);
		if (
			!acquisitionRecord
			|| !controller.instances.has(acquisitionRecord.instanceId)
			|| acquisitionRecord.expiresMs && acquisitionRecord.expiresMs < Date.now()
		) {
			return undefined;
		}
		return acquisitionRecord;
	}

	function acquire(instanceId: number, playerName: string): boolean {
		let acquisitionRecord = getAcquisition(playerName);
		if (!acquisitionRecord || acquisitionRecord.instanceId === instanceId) {
			acquiredPlayers.set(playerName, { instanceId });
			return true;
		}

		return false;
	}

	// Modifying stored data while an instance holds the player is pointless
	// as the instance uploads its own copy when the player leaves.
	function checkNotAcquired(playerName: string) {
		let acquisitionRecord = getAcquisition(playerName);
		if (acquisitionRecord) {
			let instanceName = controller.instances.get(acquisitionRecord.instanceId)!.config.get("instance.name");
			throw new lib.RequestError(
				`${playerName} is currently acquired by ${instanceName}, ` +
				"have the player leave or release the lock first"
			);
		}
	}

	controller.hooks.instanceStatusChanged.attach(plugin.name, async (instance: InstanceRecord) => {
		let instanceId = instance.id;
		if (["unassigned", "deleted"].includes(instance.status)) {
			for (let [playerName, acquisitionRecord] of acquiredPlayers) {
				if (acquisitionRecord.instanceId === instanceId) {
					acquiredPlayers.delete(playerName);
				}
			}
		}

		if (["unknown", "stopped"].includes(instance.status)) {
			let timeoutMs = controller.config.get("player_sync.player_lock_timeout") * 1000;
			for (let acquisitonRecord of acquiredPlayers.values()) {
				if (acquisitonRecord.instanceId === instanceId && !acquisitonRecord.expiresMs) {
					acquisitonRecord.expiresMs = Date.now() + timeoutMs;
				}
			}
		}

		if (instance.status === "running") {
			for (let acquisitonRecord of acquiredPlayers.values()) {
				if (acquisitonRecord.instanceId === instanceId && acquisitonRecord.expiresMs) {
					delete acquisitonRecord.expiresMs;
				}
			}
		}
	});

	controller.hooks.save.attach(plugin.name, async () => {
		if (playerDatastoreDirty) {
			playerDatastoreDirty = false;
			await saveDatabase(controller.config, playerDatastore, tombstones, logger);
		}
	});

	controller.handle(msg.AcquireRequest, async (request: msg.AcquireRequest) => {
		let { instanceId, playerName } = request;
		if (!acquire(instanceId, playerName)) {
			let acquisitionRecord = acquiredPlayers.get(playerName);
			let instance = controller.instances.get(acquisitionRecord!.instanceId)!;
			return {
				status: "busy",
				message: instance.config.get("instance.name"),
			};
		}

		let { generation, epoch } = storedVersion(playerName);
		return new msg.AcquireRequest.Response(
			"acquired",
			generation,
			playerDatastore.has(playerName),
			undefined,
			epoch || undefined,
		);
	});

	controller.handle(msg.ReleaseRequest, async (request: msg.ReleaseRequest) => {
		let { instanceId, playerName } = request;
		let acquisitionRecord = acquiredPlayers.get(playerName);
		if (!acquisitionRecord) {
			return;
		}

		if (acquisitionRecord.instanceId === instanceId) {
			acquiredPlayers.delete(playerName);
		}
	});

	controller.handle(msg.UploadRequest, async (request: msg.UploadRequest) => {
		let { instanceId, playerName, playerData } = request;
		let instanceName = controller.instances.get(instanceId)!.config.get("instance.name");
		let store = true;
		let acquisitionRecord = acquiredPlayers.get(playerName);
		if (!acquisitionRecord) {
			logger.warn(`${instanceName} uploaded ${playerName} without an acquisition`);
			// Allow upload in this case as it might come from a crashed instance that restarted and is now
			// uploading the player data for all the players that were online during the last autosave.

		} else if (acquisitionRecord.instanceId !== instanceId) {
			logger.warn(`${instanceName} uploaded ${playerName} while another instance has acquired it`);
			store = false;

		} else {
			acquiredPlayers.delete(playerName);
		}

		acquiredPlayers.delete(playerName);
		let stored = storedVersion(playerName);
		if (playerData.epoch === undefined) {
			// Instances from before epochs were added never send one, they keep the rules they had before
			stored.generation = playerDatastore.get(playerName)?.generation ?? 0;
			if (stored.epoch) {
				playerData.epoch = stored.epoch;
			}
		}
		if (store && (playerData.epoch ?? 0) !== stored.epoch) {
			logger.warn(
				`${instanceName} uploaded ${playerName} from epoch ${playerData.epoch} while the stored ` +
				`epoch is ${stored.epoch}, discarding the outdated copy`
			);
			store = false;

		} else if (store && stored.generation >= playerData.generation) {
			logger.warn(
				`${instanceName} uploaded generation ${playerData.generation} while the stored ` +
				`generation is ${stored.generation} for ${playerName}`
			);
			store = false;
		}

		if (store) {
			logger.verbose(`Received player data for ${playerName} from ${instanceName}`);
			playerDatastore.set(playerName, mergePlayerData(playerDatastore.get(playerName), playerData));
			tombstones.delete(playerName);
			playerDatastoreDirty = true;
		}
	});

	controller.handle(msg.DownloadRequest, async (request: msg.DownloadRequest) => {
		let { instanceId, playerName } = request;
		let instanceName = controller.instances.get(instanceId)!.config.get("instance.name");

		let acquisitionRecord = acquiredPlayers.get(playerName);
		if (!acquisitionRecord) {
			logger.warn(`${instanceName} downloaded ${playerName} without an acquisition`);
		} else if (acquisitionRecord.instanceId !== instanceId) {
			logger.warn(`${instanceName} downloaded ${playerName} while another instance has acquired it`);
		}

		logger.verbose(`Sending player data for ${playerName} to ${instanceName}`);
		return new msg.DownloadRequest.Response(playerDatastore.get(playerName) || null);
	});

	controller.handle(msg.DatabaseStatsRequest, async () => {
		let entries = Array.from(playerDatastore.keys())
			.map(name => ({
				name,
				length: JSON.stringify(playerDatastore.get(name)).length,
			}))
			.sort((a, b) => b.length - a.length);
		return new msg.DatabaseStatsRequest.Response(
			entries.map(x => x.length).reduce((acc, val) => acc + val, 0),
			entries.length,
			{
				name: entries[0] && entries[0].name || "-",
				size: entries[0] && entries[0].length || 0,
			},
		);
	});

	controller.handle(msg.ListPlayersRequest, async () => {
		let entries = new Map<string, msg.PlayerEntry>();
		for (let [name, playerData] of playerDatastore) {
			entries.set(name, new msg.PlayerEntry(name, playerData.generation, JSON.stringify(playerData).length));
		}
		for (let name of acquiredPlayers.keys()) {
			let acquisitionRecord = getAcquisition(name);
			if (!acquisitionRecord) {
				continue;
			}
			let entry = entries.get(name) ?? new msg.PlayerEntry(name);
			entry.instanceId = acquisitionRecord.instanceId;
			entries.set(name, entry);
		}
		return [...entries.values()];
	});

	controller.handle(msg.GetPlayerDataRequest, async (request: msg.GetPlayerDataRequest) => {
		let { playerName } = request;
		return new msg.GetPlayerDataRequest.Response(
			playerDatastore.get(playerName) ?? null,
			getAcquisition(playerName)?.instanceId,
		);
	});

	controller.handle(msg.SetPlayerDataRequest, async (request: msg.SetPlayerDataRequest) => {
		let { playerName, playerData } = request;
		checkNotAcquired(playerName);

		// A new epoch makes every instance drop its copy, including ones with an unconfirmed upload
		let stored = storedVersion(playerName);
		playerData.name = playerName;
		playerData.generation = Math.max(playerData.generation, stored.generation + 1);
		playerData.epoch = stored.epoch + 1;
		playerDatastore.set(playerName, playerData);
		tombstones.delete(playerName);
		playerDatastoreDirty = true;
		logger.info(`Replaced player data for ${playerName} with generation ${playerData.generation}`);
		return new msg.SetPlayerDataRequest.Response(playerData.generation);
	});

	controller.handle(msg.DeletePlayerDataRequest, async (request: msg.DeletePlayerDataRequest) => {
		let { playerName } = request;
		if (!playerDatastore.has(playerName)) {
			throw new lib.RequestError(`No player data stored for ${playerName}`);
		}
		checkNotAcquired(playerName);

		let { generation, epoch } = storedVersion(playerName);
		tombstones.set(playerName, { generation, epoch: epoch + 1, deleted: true });
		playerDatastore.delete(playerName);
		playerDatastoreDirty = true;
		logger.info(`Deleted player data for ${playerName}`);
	});

	controller.handle(msg.ForceReleaseRequest, async (request: msg.ForceReleaseRequest) => {
		let { playerName } = request;
		if (!acquiredPlayers.delete(playerName)) {
			throw new lib.RequestError(`${playerName} is not acquired by any instance`);
		}
		logger.info(`Released lock on ${playerName}`);
	});
}
