import type * as lib from "@clusterio/lib";

import * as messages from "./messages.js";

declare module "@clusterio/lib" {
	export interface ControllerConfigFields {
		"lobby.public_address": string | null;
		"lobby.server_browser_listing": boolean;
		"lobby.server_browser_name": string | null;
		"lobby.server_browser_description": string;
		"lobby.server_browser_tags": string;
		"lobby.server_browser_max_players": number;
	}
	export interface InstanceConfigFields {
		"lobby.is_lobby": boolean;
		"lobby.listed": boolean;
		"lobby.server_browser_listing": boolean;
	}
}

export const plugin: lib.PluginDeclaration = {
	name: "lobby",
	title: "Lobby",
	description:
		"Lobby servers players pick the instance to join from, and listing of the cluster in the Factorio " +
		"server browser. Works together with the player proxy on the controller.",
	controllerEntrypoint: "dist/node/controller.js",
	instanceEntrypoint: "dist/node/instance.js",

	controllerConfigFields: {
		"lobby.public_address": {
			title: "Public Address",
			description:
				"Address and port players reach the player proxy on, for example play.example.com:34197. " +
				"Players are sent here when they pick an instance in a lobby. If null the host name of " +
				"controller.public_url and controller.player_proxy_port is used.",
			type: "string",
			optional: true,
		},
		"lobby.server_browser_listing": {
			title: "Server Browser Listing",
			description:
				"List the cluster as one game in the Factorio server browser for each Factorio version a lobby " +
				"instance runs. Uses controller.factorio_username and controller.factorio_token.",
			type: "boolean",
			initialValue: false,
		},
		"lobby.server_browser_name": {
			title: "Server Browser Name",
			description: "Name of the cluster in the server browser, uses controller.name if null.",
			type: "string",
			optional: true,
		},
		"lobby.server_browser_description": {
			title: "Server Browser Description",
			description: "Description of the cluster in the server browser.",
			type: "string",
			initialValue: "",
		},
		"lobby.server_browser_tags": {
			title: "Server Browser Tags",
			description: "Comma separated tags for the server browser listings.",
			type: "string",
			initialValue: "clusterio",
		},
		"lobby.server_browser_max_players": {
			title: "Server Browser Max Players",
			description: "Max players shown in the server browser listings, 0 for no limit.",
			type: "number",
			initialValue: 0,
		},
	},

	instanceConfigFields: {
		"lobby.is_lobby": {
			title: "Is Lobby",
			description:
				"Players connecting to the player proxy are sent to a lobby instance running their Factorio " +
				"version, where they pick which instance to join.",
			type: "boolean",
			initialValue: false,
		},
		"lobby.listed": {
			title: "Listed",
			description: "Show this instance in the server list of lobbies.",
			type: "boolean",
			initialValue: true,
		},
		"lobby.server_browser_listing": {
			title: "Server Browser Listing",
			description:
				"List this instance as its own game in the Factorio server browser, also while it's stopped. " +
				"Requires instance.player_proxy_port to be set, players joining it while it's stopped wait in a " +
				"lobby until it has started.",
			type: "boolean",
			initialValue: false,
		},
	},

	features: [
		"SavePatching",
		"ScriptCommands",
	],

	messages: [
		messages.ServerListRequest,
		messages.TransferRequest,
		messages.TransferStatusEvent,
	],
};
