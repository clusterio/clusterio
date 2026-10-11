import type { HostPluginContext } from "@clusterio/host";
//%if multi_context
import { PluginExampleEvent, PluginExampleRequest } from "./messages.js";
//%endif

export default async function loadHostPlugin(context: HostPluginContext) {
	const { host, logger, plugin } = context;
//%if multi_context

	host.handle(PluginExampleEvent, async (event: PluginExampleEvent) => {
		logger.info(JSON.stringify(event));
	});

	host.handle(PluginExampleRequest, async (request: PluginExampleRequest) => {
		logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	});
//%endif

	host.hooks.hostConfigFieldChanged.attach(plugin.name, async (field, curr, prev) => {
		logger.info(`host::hostConfigFieldChanged ${field}`);
	});

	host.hooks.shutdown.attach(plugin.name, async () => {
		logger.info("host::shutdown");
	});
}
