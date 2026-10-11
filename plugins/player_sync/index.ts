import * as lib from "@clusterio/lib";
import * as messages from "./messages.js";

declare module "@clusterio/lib" {
	export interface InstanceConfigFields {
		"player_sync.rcon_chunk_size": number;
	}
	export interface ControllerConfigFields {
		"player_sync.player_lock_timeout": number;
	}
	export interface Permissions {
		"player_sync.inventory.view": never;
	}
}

export const plugin: lib.PluginDeclaration = {
	name: "player_sync",
	title: "Player sync",
	description: "Synchronizes player inventories and settings between instances",
	migrationEntrypoint: "dist/node/migrations.js",

	instanceEntrypoint: "dist/node/instance.js",
	instanceConfigFields: {
		"player_sync.rcon_chunk_size": {
			title: "Rcon inventory chunk size",
			description:
				"Divide inventories into chunks of this size before sending with rcon to prevent blocking the pipe",
			type: "number",
			initialValue: 1000,
		},
	},

	controllerEntrypoint: "dist/node/controller.js",
	controllerConfigFields: {
		"player_sync.player_lock_timeout": {
			title: "Player Lock Timeout",
			description:
				"Time in seconds before the lock on a player inventory expires after an instance stops " +
				"or is disconnected",
			type: "number",
			initialValue: 60,
		},
	},

	features: [
		"SavePatching",
		"ScriptCommands",
	],

	messages: [
		messages.AcquireRequest,
		messages.ReleaseRequest,
		messages.UploadRequest,
		messages.DownloadRequest,
		messages.DatabaseStatsRequest,
	],
	permissions: [
		{
			name: "player_sync.inventory.view",
			title: "View player inventories",
			description: "View player inventories",
			grantByDefault: true,
		},
	],
	webEntrypoint: "./web",
	routes: ["/inventory"],
};
