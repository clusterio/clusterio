import type * as lib from "@clusterio/lib";

import { ChatEvent } from "./messages.ts";

export const plugin: lib.PluginDeclaration = {
	name: "global_chat",
	title: "Global Chat",
	description: "Forwards chat between instances.",
	instanceEntrypoint: "./instance.ts",
	ctlEntrypoint: "./control.js",

	features: [
		"ScriptCommands",
	],

	messages: [
		ChatEvent,
	],
};
