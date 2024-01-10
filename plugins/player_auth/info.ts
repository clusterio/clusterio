import * as lib from "@clusterio/lib";
import * as messages from "./messages";

declare module "@clusterio/lib" {
	export interface InstanceConfigFields {
		"player_auth.load_plugin": boolean;
	}
	export interface ControllerConfigFields {
		"player_auth.code_length": number;
		"player_auth.code_timeout": number;
	}
}

export default {
	name: "player_auth",
	title: "Player Auth",
	description: "Provides authentication to the cluster via logging into a Factorio server.",
	controllerEntrypoint: "dist/plugin/controller",
	instanceEntrypoint: "dist/plugin/instance",
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
	},

	messages: [
		messages.FetchPlayerCodeRequest,
		messages.SetVerifyCodeRequest,
	],
} satisfies lib.PluginDeclaration;
