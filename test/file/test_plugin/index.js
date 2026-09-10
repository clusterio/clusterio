// Plugin exercising the plugin system in the integration tests, see #342.
// Written as plain JavaScript so that it does not need to be built.

import { ControllerEcho, HostEcho, HostEchoReceived } from "./messages.js";

export const plugin = {
	name: "test_plugin",
	title: "Test Plugin",
	description: "Plugin used to test the plugin system.",

	controllerEntrypoint: "controller.js",
	hostEntrypoint: "host.js",
	instanceEntrypoint: "instance.js",
	ctlEntrypoint: "control.js",

	messages: [
		ControllerEcho,
		HostEcho,
		HostEchoReceived,
	],
};
