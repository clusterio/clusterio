"use strict";
// Plugin exercising the plugin system in the integration tests, see #342.
// Written as plain JavaScript so that it does not need to be built.

const { ControllerEcho, HostEcho, HostEchoReceived } = require("./messages");

module.exports = {
	plugin: {
		name: "test_plugin",
		title: "Test Plugin",
		description: "Plugin used to test the plugin system.",

		controllerEntrypoint: "controller",
		hostEntrypoint: "host",
		instanceEntrypoint: "instance",
		ctlEntrypoint: "control",

		messages: [
			ControllerEcho,
			HostEcho,
			HostEchoReceived,
		],
	},
};
