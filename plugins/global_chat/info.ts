import type { PluginInfo } from "@clusterio/lib";

import { ChatEvent } from "./messages";

const info: PluginInfo = {
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
