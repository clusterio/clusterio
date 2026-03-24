import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";
import {
	AcquireRequest, AcquireResponse, ReleaseRequest, UploadRequest, DownloadRequest, DownloadResponse, IpcPlayerData,
} from "./messages";

type IpcPlayerName = {
	player_name: string
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

export class InstancePlugin extends BaseInstancePlugin {
	playersToRelease!: Set<string>;
	disconnecting!: boolean;

	async init() {
		this.playersToRelease = new Set();
		this.disconnecting = false;

		// Handle IPC from scenario script
		this.instance.server.on(
			"ipc-inventory_sync_acquire",
			(request: IpcPlayerName) => this.handleAcquire(request).catch(
				err => this.logger.error(`Error handling ipc-inventory_sync_acquire:\n${err.stack}`)
			),
		);
		this.instance.server.on(
			"ipc-inventory_sync_release",
			(request: IpcPlayerName) => this.handleRelease(request).catch(
				err => this.logger.error(`Error handling ipc-inventory_sync_release:\n${err.stack}`)
			),
		);
		this.instance.server.on(
			"ipc-inventory_sync_upload",
			(player_data: IpcPlayerData) => this.handleUpload(player_data).catch(
				err => this.logger.error(`Error handling ipc-inventory_sync_upload:\n${err.stack}`)
			),
		);
		this.instance.server.on(
			"ipc-inventory_sync_download",
			(request: IpcPlayerName) => this.handleDownload(request).catch(
				err => this.logger.error(`Error handling ipc-inventory_sync_download:\n${err.stack}`)
			),
		);
	}

	async onPrepareControllerDisconnect() {
		this.disconnecting = true;
	}


	onControllerConnectionEvent(event: "connect" | "drop" | "resume" | "close") {
		if (event === "connect") {
			this.disconnecting = false;
			(async () => {
				for (let player_name of this.playersToRelease) {
					if (!this.host.connector.connected || this.disconnecting) {
						return;
					}
					this.playersToRelease.delete(player_name);
					await this.instance.sendTo(
						"controller",
						new ReleaseRequest(this.instance.id, player_name)
					);
				}
			})().catch(
				err => this.logger.error(`Unpexpected error releasing queued up players:\n${err.stack}`)
			);
		}
	}

	async handleAcquire(request: IpcPlayerName) {
		let response: IpcAcquireResponse = {
			player_name: request.player_name,
			status: "error",
			message: "Controller is temporarily unavailable",
			has_data: undefined,
			generation: undefined,
		};

		if (this.host.connector.connected && !this.disconnecting) {
			try {
				let acquireResponse: AcquireResponse = await this.instance.sendTo(
					"controller",
					new AcquireRequest(this.instance.id, request.player_name),
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
					this.logger.error(`Unexpected error sending aquire request:\n${err.stack}`);
					response.message = err.message;
				}
			}
		}

		let json = lib.escapeString(JSON.stringify(response));
		await this.sendRcon(`/sc inventory_sync.acquire_response("${json}")`, true);
	}

	async handleRelease(request: IpcPlayerName) {
		if (!this.host.connector.connected) {
			this.playersToRelease.add(request.player_name);
		}

		try {
			await this.instance.sendTo(
				"controller",
				new ReleaseRequest(this.instance.id, request.player_name)
			);
		} catch (err: any) {
			if (err instanceof lib.SessionLost) {
				this.playersToRelease.add(request.player_name);
			} else {
				this.logger.error(`Unexpected error releasing player ${request.player_name}:\n${err.stack}`);
			}
		}
	}

	async handleUpload(player_data: IpcPlayerData) {
		if (!this.host.connector.connected || this.disconnecting) {
			return;
		}

		this.logger.verbose(`Uploading ${player_data.name} (${JSON.stringify(player_data).length / 1000}kB)`);
		try {
			await this.instance.sendTo(
				"controller",
				new UploadRequest(this.instance.id, player_data.name, player_data),
			);

		} catch (err: any) {
			if (!(err instanceof lib.SessionLost)) {
				this.logger.error(`Unexpected error uploading inventory for ${player_data.name}:\n${err.stack}`);
			}
			return;
		}

		await this.sendRcon(
			`/sc inventory_sync.confirm_upload("${player_data.name}", ${player_data.generation})`, true
		);
	}

	async handleDownload(request: IpcPlayerName) {
		const playerName = request.player_name;
		this.logger.verbose(`Downloading ${playerName}`);

		let response: DownloadResponse = await this.instance.sendTo(
			"controller",
			new DownloadRequest(this.instance.id, playerName)
		);

		if (!response.playerData) {
			await this.sendRcon(`/sc inventory_sync.download_inventory('${playerName}',nil,0,0)`, true);
			return;
		}

		const chunkSize = this.instance.config.get("inventory_sync.rcon_chunk_size");
		const chunks = chunkify(chunkSize, JSON.stringify(response.playerData));
		this.logger.verbose(`Sending inventory for ${playerName} in ${chunks.length} chunks`);
		for (let i = 0; i < chunks.length; i++) {
			// this.logger.verbose(`Sending chunk ${i+1} of ${chunks.length}`)
			const chunk = lib.escapeString(chunks[i]);
			await this.sendRcon(
				`/sc inventory_sync.download_inventory('${playerName}','${chunk}',${i + 1},${chunks.length})`,
				true
			);
		}
	}
}
