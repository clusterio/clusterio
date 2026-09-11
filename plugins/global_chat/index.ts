import type * as lib from "@clusterio/lib";

import { ChatEvent } from "./messages.js";

export const plugin: lib.PluginDeclaration = {
	name: "global_chat",
	title: "Global Chat",
	description: "Forwards chat between instances.",
	instanceEntrypoint: "dist/node/instance.js",
	ctlEntrypoint: "dist/node/control.js",

	features: [
		"ScriptCommands",
	],

	messages: [
		ChatEvent,
	],
};
