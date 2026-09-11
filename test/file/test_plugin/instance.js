"use strict";

module.exports.default = async function(context) {
	const { instance, plugin, logger } = context;
	logger.info("test_plugin instance loaded");

	instance.hooks.start.attach(plugin.name, async () => {
		logger.info("test_plugin instance started");
	});
};
