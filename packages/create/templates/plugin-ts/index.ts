import * as lib from "@clusterio/lib";

import { PluginExampleEvent, PluginExampleRequest } from "./messages";

lib.definePermission({
	name: "// plugin_name //.example.permission.event",
	title: "Example permission event",
	description: "My plugin's example permission that I forgot to remove",
});

lib.definePermission({
	name: "// plugin_name //.example.permission.request",
	title: "Example permission request",
	description: "My plugin's example permission that I forgot to remove",
});

export const plugin: lib.PluginDeclaration = {
	name: "// plugin_name //",
	title: "// plugin_name //",
	description: "I didn't update my description",
	// entry_points //

	messages: [
		PluginExampleEvent,
		PluginExampleRequest,
	],
};
