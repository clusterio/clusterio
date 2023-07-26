"use strict";
const messages = require("./messages");

module.exports = {
	name: "global_chat",
	title: "Global Chat",
	description: "Forwards chat between instances.",
	instanceEntrypoint: "instance",
	controlEntrypoint: "control",

	messages: [
		messages.ChatEvent,
	],
};
