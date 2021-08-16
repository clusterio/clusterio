"use strict";
let { libLink } = require("@clusterio/lib");

module.exports = {
	name: "global_chat",
	title: "Global Chat",
	description: "Forwards chat between instances.",
	instanceEntrypoint: "instance",
	controlEntrypoint: "control",

	messages: {
		chat: new libLink.Event({
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
