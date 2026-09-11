import * as lib from "@clusterio/lib";
//%if multi_context
import * as Messages from "./messages.js";
//%endif

export const plugin = {
	name: "__plugin_name__",
	title: "__plugin_name__",
	description: "Example Description. Plugin. Change me in index.js",
//%if controller | host & !config | instance & !config | ctl & !config // Blank line for formatting

//%endif
//%if controller
	controllerEntrypoint: "./dist/node/controller.js",
//%endif
//%if controller & config
	controllerConfigFields: {
		"__plugin_name__.myControllerField": {
			title: "My Controller Field",
			description: "This should be removed from index.js",
			type: "string",
			initialValue: "Remove Me",
		},
	},
//%endif
//%if host & config // Blank line for formatting

//%endif
//%if host
	hostEntrypoint: "./dist/node/host.js",
//%endif
//%if host & config
	hostConfigFields: {
		"__plugin_name__.myHostField": {
			title: "My Host Field",
			description: "This should be removed from index.js",
			type: "string",
			initialValue: "Remove Me",
		},
	},
//%endif
//%if instance & config | module & config // Blank line for formatting

//%endif
//%if instance | module // Modules load an empty instance plugin
	instanceEntrypoint: "./dist/node/instance.js",
//%endif
//%if instance & config
	instanceConfigFields: {
		"__plugin_name__.myInstanceField": {
			title: "My Instance Field",
			description: "This should be removed from index.js",
			type: "string",
			initialValue: "Remove Me",
		},
	},
//%endif
//%if ctl & config // Blank line for formatting

//%endif
//%if ctl
	ctlEntrypoint: "./dist/node/ctl.js",
//%endif
//%if ctl & config
	controlConfigFields: {
		"__plugin_name__.myControlField": {
			title: "My Control Field",
			description: "This should be removed from index.js",
			type: "string",
			initialValue: "Remove Me",
		},
	},
//%endif
//%if multi_context // Subscribing requires multi context

	messages: [
		Messages.PluginExampleEvent,
		Messages.PluginExampleRequest,
//%endif
//%if controller & web // Subscribing requires web content and the controller
		Messages.ExampleSubscribableUpdate,
//%endif
//%if multi_context // Subscribing requires multi context
	],
//%endif
//%if multi_context | web

	permissions: [
//%endif
//%if multi_context
		{
			name: "__plugin_name__.example.permission.event",
			title: "Example permission event",
			description: "Example Description. Event. Change me in index.js",
			grantByDefault: true,
		},
		{
			name: "__plugin_name__.example.permission.request",
			title: "Example permission request",
			description: "Example Description. Request. Change me in index.js",
			grantByDefault: true,
		},
//%endif
//%if controller & web // Subscribing requires web content and the controller
		{
			name: "__plugin_name__.example.permission.subscribe",
			title: "Example permission subscribe",
			description: "Example Description. Subscribe. Change me in index.js",
			grantByDefault: true,
		},
//%endif
//%if web
		{
			name: "__plugin_name__.page.view",
			title: "Example page view permission",
			description: "Example Description. View. Change me in index.js",
			grantByDefault: true,
		},
//%endif
//%if multi_context | web
	],
//%endif
//%if web // Web content template has an example route which is the plugin name

	webEntrypoint: "./web",
	routes: [
		"/__plugin_name__",
	],
//%endif
};
