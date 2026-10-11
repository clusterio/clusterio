import type { ControllerPluginContext, InstanceRecord } from "@clusterio/controller";
import type { IpcPlayerData } from "./messages.js";

import fs from "node:fs/promises";
import path from "path";
import * as lib from "@clusterio/lib";
import * as msg from "./messages.js";

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

export default async function(context: ControllerPluginContext) {
	const { controller, logger, plugin } = context;
	const acquiredPlayers = new Map<string, { instanceId: number, expiresMs?: number }>();
	const playerDatastore: Map<string, IpcPlayerData> = await loadDatabase(controller.config, logger);
	let playerDatastoreDirty = false;

	function acquire(instanceId: number, playerName: string): boolean {
		let acquisitionRecord = acquiredPlayers.get(playerName);
		if (
			!acquisitionRecord
			|| acquisitionRecord.instanceId === instanceId
			|| !controller.instances.has(acquisitionRecord.instanceId)
			|| acquisitionRecord.expiresMs && acquisitionRecord.expiresMs < Date.now()
		) {
			acquiredPlayers.set(playerName, { instanceId });
			return true;
		}

		return false;
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
			let timeoutMs = controller.config.get("inventory_sync.player_lock_timeout") * 1000;
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
			await saveDatabase(controller.config, playerDatastore, logger);
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

		let playerData = playerDatastore.get(playerName);
		return new msg.AcquireRequest.Response(
			"acquired",
			playerData ? playerData.generation : 0,
			Boolean(playerData),
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
		let oldPlayerData = playerDatastore.get(playerName);
		if (store && oldPlayerData && oldPlayerData.generation >= playerData.generation) {
			logger.warn(
				`${instanceName} uploaded generation ${playerData.generation} while the stored` +
				`generation is ${oldPlayerData.generation} for ${playerName}`
			);
			store = false;
		}

		if (store) {
			logger.verbose(`Received player data for ${playerName} from ${instanceName}`);
			playerDatastore.set(playerName, playerData);
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
}
