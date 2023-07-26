"use strict";
const messages = require("./messages");

module.exports = {
	name: "research_sync",
	title: "Research Sync",
	description: "Synchronises technology research progress between instances.",
	instanceEntrypoint: "instance",
	controllerEntrypoint: "controller",

	messages: [
		messages.ContributionEvent,
		messages.ProgressEvent,
		messages.FinishedEvent,
		messages.SyncTechnologiesRequest,
	],
};
