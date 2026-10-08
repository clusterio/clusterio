import type { InstancePluginContext } from "@clusterio/host";

import { FetchPlayerCodeRequest, SetVerifyCodeRequest } from "./messages.js";

type IpcPlayerAuth = {
	type: "open_dialog",
	player: string,
} | {
	type: "set_verify_code",
	player: string,
	verify_code: string,
}

export default async function loadInstancePlugin(context: InstancePluginContext) {
	const { instance, host, logger, plugin } = context;

	async function sendRcon(command: string) {
		await instance.sendRcon(command, false, plugin.name);
	}

	async function handleEvent(event: IpcPlayerAuth) {
		if (event.type === "open_dialog") {
			if (!host.connector.connected) {
				await sendRcon(`/web-login error ${event.player} login is temporarily unavailable`);
				return;
			}

			let response;
			try {
				response = await instance.sendTo("controller", new FetchPlayerCodeRequest(event.player));
			} catch (err: any) {
				await sendRcon(`/web-login error ${event.player} ${err.message}`);
				return;
			}
			await sendRcon(`/web-login open ${event.player} ${response.controllerUrl} ${response.playerCode}`);

		} else if (event.type === "set_verify_code") {
			try {
				await instance.sendTo("controller", new SetVerifyCodeRequest(event.player, event.verify_code));

			} catch (err: any) {
				await sendRcon(`/web-login error ${event.player} ${err.message}`);
				return;
			}

			await sendRcon(`/web-login code_set ${event.player}`);
		}
	}

	instance.server.on(
		"ipc-player_auth",
		(ipcPlayerAuth: IpcPlayerAuth) => handleEvent(ipcPlayerAuth).catch(
			err => logger.error(`Error handling event:\n${err.stack}`)
		)
	);
}
