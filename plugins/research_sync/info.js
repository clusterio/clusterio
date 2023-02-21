"use strict";
const { libLink } = require("@clusterio/lib");


// schema used for syncing technologies to and from the controller
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
	controllerEntrypoint: "controller",

	messages: {
		contribution: new libLink.Event({
			type: "research_sync:contribution",
			links: ["instance-slave", "slave-controller"],
			forwardTo: "controller",
			eventProperties: {
				"name": { type: "string" },
				"level": { type: "integer" },
				"contribution": { type: "number" },
			},
		}),
		progress: new libLink.Event({
			type: "research_sync:progress",
			links: ["controller-slave", "slave-instance"],
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
		finished: new libLink.Event({
			type: "research_sync:finished",
			links: ["instance-slave", "slave-controller", "controller-slave", "slave-instance"],
			forwardTo: "controller",
			broadcastTo: "instance",
			eventProperties: {
				"name": { type: "string" },
				"level": { type: "integer" },
			},
		}),
		syncTechnologies: new libLink.Request({
			type: "research_sync:sync_technologies",
			links: ["instance-slave", "slave-controller"],
			forwardTo: "controller",
			requestProperties: {
				"technologies": technologies,
			},
			responseProperties: {
				"technologies": technologies,
			},
		}),
	},
};
