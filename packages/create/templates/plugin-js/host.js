"use strict";
const lib = require("@clusterio/lib");
//%if multi_context
const { PluginExampleEvent, PluginExampleRequest } = require("./messages");
//%endif

module.exports.default = async function loadHostPlugin(context) {
	const { host, logger, plugin } = context;
//%if multi_context

	host.handle(PluginExampleEvent, async (event) => {
		logger.info(JSON.stringify(event));
	});

	host.handle(PluginExampleRequest, async (request) => {
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
};
