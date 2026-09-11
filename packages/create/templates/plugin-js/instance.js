"use strict";
const lib = require("@clusterio/lib");
//%if multi_context
const { PluginExampleEvent, PluginExampleRequest } = require("./messages");
//%endif

module.exports.default = async function loadInstancePlugin(context) {
	const { instance, logger, plugin } = context;
//%if multi_context

	instance.handle(PluginExampleEvent, async (event) => {
		logger.info(JSON.stringify(event));
	});

	instance.handle(PluginExampleRequest, async (request) => {
		logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	});
//%endif
//%if module

	instance.server.handle("__plugin_name__-plugin_example_ipc", async (event) => {
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

	instance.hooks.playerEvent.attach(plugin.name, async (event) => {
		logger.info(`instance::playerEvent ${JSON.stringify(event)}`);
//%if module
		if (instance.status === "running") {
			await instance.sendRcon("/sc __plugin_name__.foo()", false, plugin.name);
		}
//%endif
	});
};
