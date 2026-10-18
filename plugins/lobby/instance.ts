import * as lib from "@clusterio/lib";
import type { InstancePluginContext } from "@clusterio/host";

import { ServerListRequest, TransferRequest, TransferStatus, TransferStatusEvent } from "./messages.js";

const SERVER_LIST_INTERVAL_MS = 5_000;

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
		await sendOrderedRcon(`/sc lobby.configure(${isLobby}, ${instance.id})`);
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
