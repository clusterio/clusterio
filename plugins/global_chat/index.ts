import type * as lib from "@clusterio/lib";

import { ChatEvent } from "./messages";

export const plugin: lib.PluginDeclaration = {
	name: "global_chat",
	title: "Global Chat",
	description: "Forwards chat between instances.",
	instanceEntrypoint: "dist/node/instance",
	ctlEntrypoint: "dist/node/control",

	messages: [
		ChatEvent,
	],
};
