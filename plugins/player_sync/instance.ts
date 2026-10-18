import util from "util";
import zlib from "zlib";
import * as lib from "@clusterio/lib";
import type { InstancePluginContext } from "@clusterio/host";
import {
	AcquireRequest, AcquireResponse, ReleaseRequest, UploadRequest, DownloadRequest, DownloadResponse, IpcPlayerData,
	PrefetchEvent,
} from "./messages.js";
import { type Component, enabledComponents, stripPlayerData } from "./components.js";

type IpcPlayerName = {
	player_name: string
}

type IpcDownloadRequest = {
	player_name: string,
	recipe_notifications?: string,
}

/** Components as an escaped JSON object for the scenario. */
function componentsJson(enabled: Set<Component>) {
	return lib.escapeString(JSON.stringify(Object.fromEntries([...enabled].map(name => [name, true]))));
}

type IpcAcquireResponse = {
	player_name: string,
	status: string,
	generation?: number,
	has_data?: boolean,
	message?: string,
	epoch?: number,
	token?: string,
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
	/** add is the whole stored list, sent without the instance's: the save works out what to remove */
	full?: true,
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
 * Without a current state the whole stored list is sent, marked full.
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
		const stored = JSON.parse(await decodeLuaString(playerData.recipe_notifications));
		const delta: RecipeNotificationDelta = current
			? recipeNotificationDelta(stored, JSON.parse(await decodeLuaString(current)))
			: { ...recipeNotificationDelta(stored, []), full: true };
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
			epoch: undefined,
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
					epoch: acquireResponse.epoch,
					token: acquireResponse.token,
				};
			} catch (err: any) {
				if (!(err instanceof lib.SessionLost)) {
					logger.error(`Unexpected error sending aquire request:\n${err.stack}`);
					response.message = err.message;
				}
			}
		}

		let json = lib.escapeString(JSON.stringify(response));
		await instance.sendRcon(`/sc player_sync.acquire_response("${json}")`, true, plugin.name);
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

		// Set by the Lua module when the player left to switch servers (set_destination, which only records integers).
		// It isn't player data.
		const destinationInstanceId = player_data.destination_instance_id;
		delete player_data.destination_instance_id;

		logger.verbose(`Uploading ${player_data.name} (${JSON.stringify(player_data).length / 1000}kB)`);
		try {
			await instance.sendTo(
				"controller",
				new UploadRequest(instance.id, player_data.name, player_data, destinationInstanceId),
			);

		} catch (err: any) {
			if (!(err instanceof lib.SessionLost)) {
				logger.error(`Unexpected error uploading inventory for ${player_data.name}:\n${err.stack}`);
			}
			return;
		}

		await instance.sendRcon(
			`/sc player_sync.confirm_upload("${player_data.name}", ${player_data.generation})`, true, plugin.name
		);
	}

	/**
	 * Send player data to the save in chunks of player_sync.rcon_chunk_size, stripped to the components synced here
	 * and with its recipe notifications as a delta from current. command(chunk, number, total, extra) gives the RCON
	 * command for each escaped chunk, numbered from 1; extra passes the components the data was stripped by with
	 * chunk 1 and is empty for the rest. With stopOnReply a non-empty reply (the save refusing or ignoring the data)
	 * ends the transfer; without it any reply throws, as sendRcon's expectEmpty does.
	 */
	async function sendPlayerData(
		playerData: IpcPlayerData,
		current: string | undefined,
		command: (chunk: string, number: number, total: number, extra: string) => string,
		stopOnReply: boolean,
	) {
		const enabled = enabledComponents(instance.config);
		stripPlayerData(playerData, enabled);
		await applyRecipeNotificationDelta(playerData, current, logger);

		const chunks = chunkify(instance.config.get("player_sync.rcon_chunk_size"), JSON.stringify(playerData));
		logger.verbose(`Sending inventory for ${playerData.name} in ${chunks.length} chunks`);
		// The scenario restarts a download, and drops a prefetched copy at the join, sent with other components
		const components = componentsJson(enabled);
		for (let i = 0; i < chunks.length; i++) {
			const extra = i === 0 ? `,'${components}'` : "";
			const reply = await instance.sendRcon(
				command(lib.escapeString(chunks[i]), i + 1, chunks.length, extra), !stopOnReply, plugin.name,
			);
			if (stopOnReply && reply !== "") {
				logger.verbose(`Stopped sending ${playerData.name}: ${reply.trim()}`);
				return;
			}
		}
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
				`/sc player_sync.download_inventory('${playerName}',nil,0,0)`, true, plugin.name
			);
			return;
		}

		await sendPlayerData(response.playerData, request.recipe_notifications, (chunk, number, total, extra) => (
			`/sc player_sync.download_inventory('${playerName}','${chunk}',${number},${total}${extra})`
		), false);
	}

	// Handle IPC from scenario script
	instance.server.on(
		"ipc-player_sync_acquire",
		(request: IpcPlayerName) => handleAcquire(request).catch(
			err => logger.error(`Error handling ipc-player_sync_acquire:\n${err.stack}`)
		),
	);
	instance.server.on(
		"ipc-player_sync_release",
		(request: IpcPlayerName) => handleRelease(request).catch(
			err => logger.error(`Error handling ipc-player_sync_release:\n${err.stack}`)
		),
	);
	instance.server.on(
		"ipc-player_sync_upload",
		(player_data: IpcPlayerData) => handleUpload(player_data).catch(
			err => logger.error(`Error handling ipc-player_sync_upload:\n${err.stack}`)
		),
	);
	instance.server.on(
		"ipc-player_sync_download",
		(request: IpcDownloadRequest) => handleDownload(request).catch(
			err => logger.error(`Error handling ipc-player_sync_download:\n${err.stack}`)
		),
	);

	// A copy of a player's stored data, sent ahead while they switch to this instance (player_sync.prefetch_inventory)
	async function handlePrefetch(event: PrefetchEvent) {
		const { playerData, token } = event;
		const { name, generation } = playerData;
		logger.verbose(`Prefetching ${name}`);
		// This side doesn't know the save's cleared recipe list, so the whole stored list goes as a full delta
		await sendPlayerData(playerData, undefined, (chunk, number, total, extra) => {
			// Later chunks have no components argument, so nil holds its place
			const tokenArg = number === 1 ? `,'${token}'` : `,nil,'${token}'`;
			const args = `'${name}',${generation},'${chunk}',${number},${total}${extra}${tokenArg}`;
			return `/sc player_sync.prefetch_inventory(${args})`;
		}, true);
	}
	instance.handle(PrefetchEvent, handlePrefetch);

	/** Tell the scenario which components are synced. */
	async function sendComponents() {
		const json = componentsJson(enabledComponents(instance.config));
		await instance.sendRcon(`/sc player_sync.set_components("${json}")`, true, plugin.name);
	}

	instance.hooks.start.attach(plugin.name, sendComponents);

	instance.hooks.instanceConfigFieldChanged.attach(plugin.name, async (field) => {
		if (field.startsWith("player_sync.sync_") && instance.status === "running") {
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
