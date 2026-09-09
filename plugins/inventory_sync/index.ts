import * as lib from "@clusterio/lib";
import * as messages from "./messages";

declare module "@clusterio/lib" {
	export interface InstanceConfigFields {
		"inventory_sync.rcon_chunk_size": number;
	}
	export interface ControllerConfigFields {
		"inventory_sync.player_lock_timeout": number;
	}
}

lib.definePermission({
	name: "inventory_sync.inventory.view",
	title: "View player inventories",
	description: "View player inventories",
	grantByDefault: true,
});

lib.definePermission({
	name: "inventory_sync.inventory.modify",
	title: "Modify player inventories",
	description: "Replace, delete and release the lock on player inventories stored on the controller",
});

export const plugin: lib.PluginDeclaration = {
	name: "inventory_sync",
	title: "Inventory sync",
	description: "Synchronizes players inventories between instances",

	instanceEntrypoint: "dist/node/instance",
	instanceConfigFields: {
		"inventory_sync.rcon_chunk_size": {
			title: "Rcon inventory chunk size",
			description:
				"Divide inventories into chunks of this size before sending with rcon to prevent blocking the pipe",
			type: "number",
			initialValue: 1000,
		},
	},

	controllerEntrypoint: "dist/node/controller",
	ctlEntrypoint: "dist/node/control",
	controllerConfigFields: {
		"inventory_sync.player_lock_timeout": {
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
		messages.ListPlayersRequest,
		messages.GetPlayerDataRequest,
		messages.SetPlayerDataRequest,
		messages.DeletePlayerDataRequest,
		messages.ForceReleaseRequest,
	],
	webEntrypoint: "./web",
	routes: ["/inventory"],
};
