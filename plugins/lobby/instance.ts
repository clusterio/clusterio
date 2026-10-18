import fs from "node:fs/promises";

import * as lib from "@clusterio/lib";
import { type InstancePluginContext, setSaveScenario } from "@clusterio/host";

import { ServerListRequest, TransferRequest, TransferStatus, TransferStatusEvent } from "./messages.js";

const SERVER_LIST_INTERVAL_MS = 5_000;

/** Save lobby instances start, created if it doesn't exist */
export const LOBBY_SAVE = "lobby.zip";

/**
 * Map gen settings for an empty world
 *
 * A width or height of 0 means unlimited to Factorio, so the map is made
 * a single tile with everything outside it out of map.
 */
export const lobbyMapGenSettings = {
	width: 1,
	height: 1,
	starting_points: [{ x: 0, y: 0 }],
	peaceful_mode: true,
	no_enemies_mode: true,
	default_enable_all_autoplace_controls: false,
	autoplace_controls: {},
	autoplace_settings: {
		entity: { treat_missing_as_default: false, settings: {} },
		decorative: { treat_missing_as_default: false, settings: {} },
	},
	cliff_settings: { name: "cliff", richness: 0 },
};

// ./module/lobby.lua
type IpcConnect = {
	player: string,
	instance_id: number,
};

export default async function loadInstancePlugin(context: InstancePluginContext) {
	const { instance, logger, plugin } = context;
	let serverListTimer: ReturnType<typeof setInterval> | undefined;
	let lastServerListJson = "";

	// Commands are sent one at a time so they execute in order
	let rconQueue: Promise<unknown> = Promise.resolve();
	function sendOrderedRcon(command: string) {
		const result = rconQueue.then(() => instance.sendRcon(command, true, plugin.name));
		rconQueue = result.catch(() => {});
		return result;
	}

	function running() {
		return ["starting", "running"].includes(instance.status);
	}

	async function configure() {
		const isLobby = instance.config.get("lobby.is_lobby");
		// The player_auth module opens its login dialog from the same IPC message as its /web-login command
		const webLogin = [...instance.loadedPlugins].some(info => info.name === "player_auth");
		await sendOrderedRcon(`/sc lobby.configure(${isLobby}, ${instance.id}, ${webLogin})`);
	}

	async function updateServerList() {
		if (!running()) {
			return;
		}
		const servers = await instance.sendTo("controller", new ServerListRequest());
		const json = JSON.stringify(servers);
		if (json === lastServerListJson) {
			return;
		}
		lastServerListJson = json;
		await sendOrderedRcon(`/sc lobby.set_servers("${lib.escapeString(json)}")`);
	}

	async function applyStatus(player: string, status: TransferStatus) {
		if (!running()) {
			return;
		}
		const name = lib.escapeString(player);
		if (status.state === "ready" && status.address) {
			await sendOrderedRcon(
				`/sc lobby.connect_player("${name}", "${lib.escapeString(status.address)}", ` +
				`"${lib.escapeString(status.name)}")`
			);
			return;
		}
		const text = status.state === "starting"
			? `Starting ${status.name}, you will be moved there once it's up.`
			: `Unable to join ${status.name}: ${status.message ?? "unknown error"}`;
		await sendOrderedRcon(`/sc lobby.set_player_status("${name}", "${lib.escapeString(text)}")`);
	}

	instance.hooks.chooseSave.attach(plugin.name, async () => {
		if (!instance.config.get("lobby.is_lobby")) {
			return undefined;
		}
		const savePath = instance.path("saves", LOBBY_SAVE);
		try {
			await fs.access(savePath);
		} catch {
			logger.info("Creating empty lobby save");
			await instance.server.create(LOBBY_SAVE, undefined, lobbyMapGenSettings);
			// Saves are created with the freeplay scenario, replace it with one that does nothing
			await setSaveScenario(savePath, new lib.ModuleInfo("lobby", "0.0.0"));
		}
		return LOBBY_SAVE;
	});

	instance.hooks.start.attach(plugin.name, async () => {
		await configure();
		lastServerListJson = "";
		await updateServerList();
		serverListTimer = setInterval(() => {
			updateServerList().catch(err => logger.error(`Failed to update server list:\n${err.stack}`));
		}, SERVER_LIST_INTERVAL_MS);
	});

	instance.hooks.stop.attach(plugin.name, async () => {
		clearInterval(serverListTimer);
		serverListTimer = undefined;
	});

	instance.hooks.instanceConfigFieldChanged.attach(plugin.name, async field => {
		if (field === "lobby.is_lobby" && running()) {
			await configure();
		}
	});

	instance.server.handle("lobby:connect", async (data: IpcConnect) => {
		let status: TransferStatus;
		try {
			status = await instance.sendTo("controller", new TransferRequest(data.player, data.instance_id));
		} catch (err: any) {
			status = new TransferStatus("failed", String(data.instance_id), undefined, err.message);
		}
		await applyStatus(data.player, status);
	});

	instance.handle(TransferStatusEvent, async event => {
		await applyStatus(event.player, event.status);
	});
}
