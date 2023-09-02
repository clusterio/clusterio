import type * as lib from "@clusterio/lib";

import { ChatEvent } from "./messages";

const info: lib.PluginDeclaration = {
	name: "global_chat",
	title: "Global Chat",
	description: "Forwards chat between instances.",
	instanceEntrypoint: "dist/plugin/instance",
	controlEntrypoint: "dist/plugin/control",

	messages: [
		ChatEvent,
	],
}

export default info;
