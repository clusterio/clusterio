"use strict";
const lib = require("@clusterio/lib");
const messages = require("./messages");

lib.definePermission({
	name: "// plugin_name //.example.permission.event",
	title: "Example permission event",
	description: "My plugin's example permission that I forgot to remove",
});

lib.definePermission({
	name: "// plugin_name //.example.permission.request",
	title: "Example permission request",
	description: "My plugin's example permission that I forgot to remove",
});// [subscribable] //

lib.definePermission({
	name: "// plugin_name //.example.permission.subscribe",
	title: "Example permission subscribe",
	description: "My plugin's example permission that I forgot to remove",
});// [] //// [web] //

lib.definePermission({
	name: "// plugin_name //.page.view",
	title: "Example page view permission",
	description: "My plugin's example page permission that I forgot to remove",
});// [] //

const plugin = {
	name: "// plugin_name //",
	title: "// plugin_name //",
	description: "I didn't update my description",// [entry_points] //
	// entry_points //
// [] //// [controller] //
	controllerConfigFields: {
		"// plugin_name //.myControllerField": {
			title: "My Controller Field",
			description: "This should be removed",
			type: "string",
			initialValue: "Remove Me",
		},
	},// [] //// [host] //
	hostConfigFields: {
		"// plugin_name //.myHostField": {
			title: "My Host Field",
			description: "This should be removed",
			type: "string",
			initialValue: "Remove Me",
		},
	},// [] //// [instance] //
	instanceConfigFields: {
		"// plugin_name //.myInstanceField": {
			title: "My Instance Field",
			description: "This should be removed",
			type: "string",
			initialValue: "Remove Me",
		},
	},// [] //// [ctl] //
	controlConfigFields: {
		"// plugin_name //.myControlField": {
			title: "My Control Field",
			description: "This should be removed",
			type: "string",
			initialValue: "Remove Me",
		},
	},// [] //

	messages: [
		messages.PluginExampleEvent,
		messages.PluginExampleRequest,// [subscribable] //
		messages.ExampleSubscribableUpdate,// [] //
	],
};

module.exports = {
	plugin,
	PluginExampleEvent,
	PluginExampleRequest,
};
