"use strict";
const link = require("@clusterio/lib/link");


// schema used for syncing technologies to and from the master
const technologies = {
	type: "array",
	items: {
		type: "array",
		minItems: 4,
		maxItems: 4,
		items: [
			{ type: "string" },
			{ type: "integer" },
			{ type: ["null", "number"] },
			{ type: "boolean" },
		],
	},
};

module.exports = {
	name: "research_sync",
	title: "Research Sync",
	description: "Synchronises technology research progress between instances.",
	instanceEntrypoint: "instance",
	masterEntrypoint: "master",

	messages: {
		contribution: new link.Event({
			type: "research_sync:contribution",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			eventProperties: {
				"name": { type: "string" },
				"level": { type: "integer" },
				"contribution": { type: "number" },
			},
		}),
		progress: new link.Event({
			type: "research_sync:progress",
			links: ["master-slave", "slave-instance"],
			broadcastTo: "instance",
			eventProperties: {
				"technologies": {
					type: "array",
					items: {
						additionalProperties: false,
						required: ["name", "level", "progress"],
						properties: {
							"name": { type: "string" },
							"level": { type: "integer" },
							"progress": { type: "number" },
						},
					},
				},
			},
		}),
		finished: new link.Event({
			type: "research_sync:finished",
			links: ["instance-slave", "slave-master", "master-slave", "slave-instance"],
			forwardTo: "master",
			broadcastTo: "instance",
			eventProperties: {
				"name": { type: "string" },
				"level": { type: "integer" },
			},
		}),
		syncTechnologies: new link.Request({
			type: "research_sync:sync_technologies",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			requestProperties: {
				"technologies": technologies,
			},
			responseProperties: {
				"technologies": technologies,
			},
		}),
	},
};
