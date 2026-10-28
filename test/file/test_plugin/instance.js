import * as lib from "@clusterio/lib";

import { InstanceEcho } from "./messages.js";

export default async function(context) {
	const { instance, plugin, logger } = context;
	logger.info("test_plugin instance loaded");

	instance.hooks.start.attach(plugin.name, async () => {
		logger.info("test_plugin instance started");
	});

	instance.handle(InstanceEcho, async (request) => {
		logger.info(`test_plugin instance echo ${request.text}`);
		const text = lib.escapeString(request.text);
		const response = await instance.sendRcon(`/sc rcon.print(remote.call("test_plugin", "echo", "${text}"))`);
		return response.replace(/\n$/, "");
	});
}
