"use strict";
let link = require("@clusterio/lib/link");
let plugin = require("@clusterio/lib/plugin");

module.exports = {
	name: "global_chat",
	title: "Global Chat",
	description: "Forwards chat between instances.",
	instanceEntrypoint: "instance",
	controlEntrypoint: "control",

	messages: {
		chat: new link.Event({
			type: "global_chat:chat",
			links: ["instance-slave", "slave-master", "master-slave", "slave-instance", "control-master"],
			forwardTo: "master",
			broadcastTo: "instance",
			eventProperties: {
				"instance_name": { type: "string" },
				"content": { type: "string" },
			},
		}),
	},
};
