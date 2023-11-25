import { CommandTree, Command } from "@clusterio/lib";
import { BaseCtlPlugin } from "@clusterio/ctl";
import { ChatEvent } from "./messages";

const globalChatCommands = new CommandTree({
	name: "global-chat", description: "Global Chat plugin commands",
});
globalChatCommands.add(new Command({
	definition: ["shout <message>", "Send message to all instances", (yargs) => {
		yargs.positional("message", { describe: "message to send", type: "string" });
	}],
	handler: async function(args, control) {
		await control.sendTo("allInstances", new ChatEvent("Console", args.message));
	},
}));

export class CtlPlugin extends BaseCtlPlugin {
	async addCommands(rootCommand: CommandTree) {
		rootCommand.add(globalChatCommands);
	}
}
