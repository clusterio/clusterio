import * as lib from "@clusterio/lib";
import * as messages from "./messages.js";

declare module "@clusterio/lib" {
	export interface InstanceConfigFields {
		"inventory_sync.rcon_chunk_size": number;
		"inventory_sync.sync_controller": boolean;
		"inventory_sync.sync_force": boolean;
		"inventory_sync.sync_appearance": boolean;
		"inventory_sync.sync_inventories": boolean;
		"inventory_sync.sync_logistics": boolean;
		"inventory_sync.sync_quick_bar": boolean;
		"inventory_sync.sync_settings": boolean;
		"inventory_sync.sync_recipe_notifications": boolean;
	}
	export interface ControllerConfigFields {
		"inventory_sync.player_lock_timeout": number;
	}
	export interface Permissions {
		"inventory_sync.inventory.view": never;
	}
}

export const plugin: lib.PluginDeclaration = {
	name: "inventory_sync",
	title: "Inventory sync",
	description: "Synchronizes players inventories between instances",

	instanceEntrypoint: "dist/node/instance.js",
	instanceConfigFields: {
		"inventory_sync.rcon_chunk_size": {
			title: "Rcon inventory chunk size",
			description:
				"Divide inventories into chunks of this size before sending with rcon to prevent blocking the pipe",
			type: "number",
			initialValue: 1000,
		},
		"inventory_sync.sync_controller": {
			title: "Sync controller",
			description:
				"Sync whether the player is a character, god or spectator, their respawn timer, cheat mode " +
				"and god inventory. Only synced while inventories are synced too.",
			type: "boolean",
			initialValue: true,
		},
		"inventory_sync.sync_force": {
			title: "Sync force",
			description: "Sync the force the player is on.",
			type: "boolean",
			initialValue: true,
		},
		"inventory_sync.sync_appearance": {
			title: "Sync appearance",
			description: "Sync the player color, chat color and tag.",
			type: "boolean",
			initialValue: true,
		},
		"inventory_sync.sync_inventories": {
			title: "Sync inventories",
			description:
				"Sync the character inventories, character bonuses and crafting queue. Without the " +
				"controller synced a player without a character keeps their local inventory.",
			type: "boolean",
			initialValue: true,
		},
		"inventory_sync.sync_logistics": {
			title: "Sync logistics",
			description: "Sync the personal logistic requests.",
			type: "boolean",
			initialValue: true,
		},
		"inventory_sync.sync_quick_bar": {
			title: "Sync quick bar",
			description: "Sync the quick bar.",
			type: "boolean",
			initialValue: true,
		},
		"inventory_sync.sync_settings": {
			title: "Sync settings",
			description: "Sync the shortcut toggles, game view settings and flashlight.",
			type: "boolean",
			initialValue: true,
		},
		"inventory_sync.sync_recipe_notifications": {
			title: "Sync recipe notifications",
			description: "Sync which new recipe notifications have been seen.",
			type: "boolean",
			initialValue: true,
		},
	},

	controllerEntrypoint: "dist/node/controller.js",
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
	],
	permissions: [
		{
			name: "inventory_sync.inventory.view",
			title: "View player inventories",
			description: "View player inventories",
			grantByDefault: true,
		},
	],
	webEntrypoint: "./web",
	routes: ["/inventory"],
};
