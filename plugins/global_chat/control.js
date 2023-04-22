"use strict";
const libPlugin = require("@clusterio/lib/plugin");
const { ChatEvent } = require("./messages");
const libCommand = require("@clusterio/lib/command");


const globalChatCommands = new libCommand.CommandTree({
	name: "global-chat", description: "Global Chat plugin commands",
});
globalChatCommands.add(new libCommand.Command({
	definition: ["shout <message>", "Send message to all instances", (yargs) => {
		yargs.positional("message", { describe: "message to send", type: "string" });
	}],
	handler: async function(args, control) {
		await control.sendTo(new ChatEvent("Console", args.message), "allInstances");
	},
}));

class ControlPlugin extends libPlugin.BaseControlPlugin {
	async addCommands(rootCommand) {
		rootCommand.add(globalChatCommands);
	}
}

module.exports = {
	ControlPlugin,
};
