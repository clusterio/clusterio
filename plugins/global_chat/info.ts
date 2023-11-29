import type * as lib from "@clusterio/lib";

import { ChatEvent } from "./messages";

export default {
	name: "global_chat",
	title: "Global Chat",
	description: "Forwards chat between instances.",
	instanceEntrypoint: "dist/plugin/instance",
	ctlEntrypoint: "dist/plugin/control",

	messages: [
		ChatEvent,
	],
} satisfies lib.PluginDeclaration;
