import * as lib from "@clusterio/lib";
import * as messages from "./messages";

declare module "@clusterio/lib" {
	export interface InstanceConfigFields {
		"player_auth.load_plugin": boolean;
	}
	export interface ControllerConfigFields {
		"player_auth.code_length": number;
		"player_auth.code_timeout": number;
		"player_auth.show_connect_address": boolean;
	}
}

export const plugin: lib.PluginDeclaration = {
	name: "player_auth",
	title: "Player Auth",
	description: "Provides authentication to the cluster via logging into a Factorio server.",
	controllerEntrypoint: "dist/node/controller",
	instanceEntrypoint: "dist/node/instance",
	webEntrypoint: "./web",
	controllerConfigFields: {
		"player_auth.code_length": {
			title: "Code Length",
			description: "Length in characters of the generated codes.",
			type: "number",
			initialValue: 6,
		},
		"player_auth.code_timeout": {
			title: "Code Timeout",
			description: "Time in seconds for the generated codes to stay valid.",
			type: "number",
			initialValue: 120,
		},
		"player_auth.show_connect_address": {
			title: "Show Connect Address",
			description: "Show server connect addresses to unauthenticated users.",
			type: "boolean",
			initialValue: false,
		},
	},

	features: [
		"SavePatching",
	],

	messages: [
		messages.FetchPlayerCodeRequest,
		messages.SetVerifyCodeRequest,
	],
};
