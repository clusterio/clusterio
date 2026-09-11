import * as lib from "@clusterio/lib";
import type { InstancePluginContext } from "@clusterio/host";
//%if multi_context
import { PluginExampleEvent, PluginExampleRequest } from "./messages";
//%endif
//%if module

type PluginExampleIPC = {
	tick: number,
	player_name: string,
};
//%endif

export default async function loadInstancePlugin(context: InstancePluginContext) {
	const { instance, logger, plugin } = context;
//%if multi_context

	instance.handle(PluginExampleEvent, async (event: PluginExampleEvent) => {
		logger.info(JSON.stringify(event));
	});

	instance.handle(PluginExampleRequest, async (request: PluginExampleRequest) => {
		logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	});
//%endif
//%if module

	instance.server.handle("__plugin_name__-plugin_example_ipc", async (event: PluginExampleIPC) => {
		logger.info(JSON.stringify(event));
	});
//%endif

	instance.hooks.instanceConfigFieldChanged.attach(plugin.name, async (field, curr, prev) => {
		logger.info(`instance::instanceConfigFieldChanged ${field}`);
	});

	instance.hooks.start.attach(plugin.name, async () => {
		// Called once rcon becomes available
		logger.info("instance::start");
	});

	instance.hooks.stop.attach(plugin.name, async () => {
		// Called during normal exits before rcon becomes unavailable
		logger.info("instance::stop");
	});

	instance.hooks.exit.attach(plugin.name, () => {
		// Called during all exits, including crashes and init failures, rcon is not available
		logger.info("instance::exit");
	});

	instance.hooks.playerEvent.attach(plugin.name, async (event: lib.PlayerEvent) => {
		logger.info(`instance::playerEvent ${JSON.stringify(event)}`);
//%if module
		if (instance.status === "running") {
			await instance.sendRcon("/sc __plugin_name__.foo()", false, plugin.name);
		}
//%endif
	});
}
