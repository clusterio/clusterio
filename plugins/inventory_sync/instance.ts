import util from "util";
import zlib from "zlib";
import * as lib from "@clusterio/lib";
import type { InstancePluginContext } from "@clusterio/host";
import {
	AcquireRequest, AcquireResponse, ReleaseRequest, UploadRequest, DownloadRequest, DownloadResponse, IpcPlayerData,
} from "./messages.js";
import { enabledComponents, stripPlayerData } from "./components.js";

type IpcPlayerName = {
	player_name: string
}

type IpcDownloadRequest = {
	player_name: string,
	recipe_notifications?: string,
}

type IpcAcquireResponse = {
	player_name: string,
	status: string,
	generation?: number,
	has_data?: boolean,
	message?: string,
}

/**
 * Splits string into array of strings with max of a certain length
 * @param chunkSize - Max length of each chunk
 * @param string - String to split into chunks
 * @returns array of substrings
 */
function chunkify(chunkSize: number, string: string): string[] {
	return string.match(new RegExp(`.{1,${chunkSize}}`, "g")) || [];
}

const inflate = util.promisify(zlib.inflate);
const deflate = util.promisify(zlib.deflate);

/**
 * Decode a string produced by helpers.encode_string in Factorio
 */
async function decodeLuaString(encoded: string): Promise<string> {
	return (await inflate(Buffer.from(encoded, "base64"))).toString("utf8");
}

/**
 * Encode a string so that helpers.decode_string in Factorio can read it
 */
async function encodeLuaString(text: string): Promise<string> {
	return (await deflate(Buffer.from(text, "utf8"))).toString("base64");
}

export type RecipeNotificationDelta = {
	add?: string[],
	remove?: string[],
}

/**
 * Compute the changes needed to turn the current cleared recipe list into the stored one
 * @param stored - Cleared recipe names stored on the controller
 * @param current - Cleared recipe names the instance currently has
 * @returns names to add to and remove from the current list
 */
export function recipeNotificationDelta(stored: string[], current: string[]): RecipeNotificationDelta {
	const storedSet = new Set(stored);
	const currentSet = new Set(current);
	const delta: RecipeNotificationDelta = {};
	const add = stored.filter(name => !currentSet.has(name));
	const remove = current.filter(name => !storedSet.has(name));
	if (add.length) {
		delta.add = add;
	}
	if (remove.length) {
		delta.remove = remove;
	}
	return delta;
}

/**
 * Replace the stored recipe notifications with the difference from the
 * current state on the instance to reduce the amount of data sent to Lua.
 */
export async function applyRecipeNotificationDelta(
	playerData: IpcPlayerData,
	current: string | undefined,
	logger: lib.Logger,
) {
	if (!playerData.recipe_notifications) {
		return;
	}
	try {
		const delta = recipeNotificationDelta(
			JSON.parse(await decodeLuaString(playerData.recipe_notifications)),
			current ? JSON.parse(await decodeLuaString(current)) : [],
		);
		playerData.recipe_notifications = await encodeLuaString(JSON.stringify(delta));
	} catch (err: any) {
		logger.warn(`Dropping invalid recipe notifications for ${playerData.name}:\n${err.stack}`);
		delete playerData.recipe_notifications;
	}
}

export default async function(context: InstancePluginContext) {
	const { instance, host, logger, plugin } = context;
	const playersToRelease = new Set<string>();
	let disconnecting = false;

	async function handleAcquire(request: IpcPlayerName) {
		let response: IpcAcquireResponse = {
			player_name: request.player_name,
			status: "error",
			message: "Controller is temporarily unavailable",
			has_data: undefined,
			generation: undefined,
		};

		if (host.connector.connected && !disconnecting) {
			try {
				let acquireResponse: AcquireResponse = await instance.sendTo(
					"controller",
					new AcquireRequest(instance.id, request.player_name),
				);
				response = {
					player_name: request.player_name,
					status: acquireResponse.status,
					generation: acquireResponse.generation,
					has_data: acquireResponse.hasData,
					message: acquireResponse.message,
				};
			} catch (err: any) {
				if (!(err instanceof lib.SessionLost)) {
					logger.error(`Unexpected error sending aquire request:\n${err.stack}`);
					response.message = err.message;
				}
			}
		}

		let json = lib.escapeString(JSON.stringify(response));
		await instance.sendRcon(`/sc inventory_sync.acquire_response("${json}")`, true, plugin.name);
	}

	async function handleRelease(request: IpcPlayerName) {
		if (!host.connector.connected) {
			playersToRelease.add(request.player_name);
		}

		try {
			await instance.sendTo(
				"controller",
				new ReleaseRequest(instance.id, request.player_name)
			);
		} catch (err: any) {
			if (err instanceof lib.SessionLost) {
				playersToRelease.add(request.player_name);
			} else {
				logger.error(`Unexpected error releasing player ${request.player_name}:\n${err.stack}`);
			}
		}
	}

	async function handleUpload(player_data: IpcPlayerData) {
		if (!host.connector.connected || disconnecting) {
			return;
		}

		logger.verbose(`Uploading ${player_data.name} (${JSON.stringify(player_data).length / 1000}kB)`);
		try {
			await instance.sendTo(
				"controller",
				new UploadRequest(instance.id, player_data.name, player_data),
			);

		} catch (err: any) {
			if (!(err instanceof lib.SessionLost)) {
				logger.error(`Unexpected error uploading inventory for ${player_data.name}:\n${err.stack}`);
			}
			return;
		}

		await instance.sendRcon(
			`/sc inventory_sync.confirm_upload("${player_data.name}", ${player_data.generation})`, true, plugin.name
		);
	}

	async function handleDownload(request: IpcDownloadRequest) {
		const playerName = request.player_name;
		logger.verbose(`Downloading ${playerName}`);

		let response: DownloadResponse = await instance.sendTo(
			"controller",
			new DownloadRequest(instance.id, playerName)
		);

		if (!response.playerData) {
			await instance.sendRcon(
				`/sc inventory_sync.download_inventory('${playerName}',nil,0,0)`, true, plugin.name
			);
			return;
		}

		stripPlayerData(response.playerData, enabledComponents(instance.config));
		await applyRecipeNotificationDelta(response.playerData, request.recipe_notifications, logger);

		const chunkSize = instance.config.get("inventory_sync.rcon_chunk_size");
		const chunks = chunkify(chunkSize, JSON.stringify(response.playerData));
		logger.verbose(`Sending inventory for ${playerName} in ${chunks.length} chunks`);
		for (let i = 0; i < chunks.length; i++) {
			const chunk = lib.escapeString(chunks[i]);
			await instance.sendRcon(
				`/sc inventory_sync.download_inventory('${playerName}','${chunk}',${i + 1},${chunks.length})`,
				true,
				plugin.name,
			);
		}
	}

	// Handle IPC from scenario script
	instance.server.on(
		"ipc-inventory_sync_acquire",
		(request: IpcPlayerName) => handleAcquire(request).catch(
			err => logger.error(`Error handling ipc-inventory_sync_acquire:\n${err.stack}`)
		),
	);
	instance.server.on(
		"ipc-inventory_sync_release",
		(request: IpcPlayerName) => handleRelease(request).catch(
			err => logger.error(`Error handling ipc-inventory_sync_release:\n${err.stack}`)
		),
	);
	instance.server.on(
		"ipc-inventory_sync_upload",
		(player_data: IpcPlayerData) => handleUpload(player_data).catch(
			err => logger.error(`Error handling ipc-inventory_sync_upload:\n${err.stack}`)
		),
	);
	instance.server.on(
		"ipc-inventory_sync_download",
		(request: IpcDownloadRequest) => handleDownload(request).catch(
			err => logger.error(`Error handling ipc-inventory_sync_download:\n${err.stack}`)
		),
	);

	/** Tell the scenario which components are synced. */
	async function sendComponents() {
		const enabled = Object.fromEntries([...enabledComponents(instance.config)].map(name => [name, true]));
		const json = lib.escapeString(JSON.stringify(enabled));
		await instance.sendRcon(`/sc inventory_sync.set_components("${json}")`, true, plugin.name);
	}

	instance.hooks.start.attach(plugin.name, sendComponents);

	instance.hooks.instanceConfigFieldChanged.attach(plugin.name, async (field) => {
		if (field.startsWith("inventory_sync.sync_") && instance.status === "running") {
			await sendComponents();
		}
	});

	instance.hooks.prepareControllerDisconnect.attach(plugin.name, async () => {
		disconnecting = true;
	});

	instance.hooks.controllerConnectionEvent.attach(plugin.name, async (event) => {
		if (event === "connect") {
			disconnecting = false;
			(async () => {
				for (let player_name of playersToRelease) {
					if (!host.connector.connected || disconnecting) {
						return;
					}
					playersToRelease.delete(player_name);
					await instance.sendTo(
						"controller",
						new ReleaseRequest(instance.id, player_name)
					);
				}
			})().catch(
				err => logger.error(`Unpexpected error releasing queued up players:\n${err.stack}`)
			);
		}
	});
}
