let link = require("lib/link");
let plugin = require("lib/plugin");

module.exports = {
	name: "global_chat",
	title: "Global Chat",
	description: "Forwards chat between instances.",
	version: "2.0.0-alpha",
	instanceEntrypoint: "instance",

	messages: {
		chat: new link.Event({
			type: "global_chat:chat",
			links: ["instance-slave", "slave-master", "master-slave", "slave-instance"],
			forwardTo: "master",
			broadcastTo: "instance",
			eventProperties: {
				"instance_name": { type: "string" },
				"content": { type: "string" },
			},
		}),
	},
}
