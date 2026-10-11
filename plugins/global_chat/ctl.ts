import { CommandTree, Command } from "@clusterio/lib";
import type { CtlPluginContext } from "@clusterio/ctl";
import { ChatEvent } from "./messages.js";

const globalChatCommands = new CommandTree({
	name: "global-chat", description: "Global Chat plugin commands",
});
globalChatCommands.add(new Command({
	definition: ["shout <message>", "Send message to all instances", (yargs) => {
		yargs.positional("message", { describe: "message to send", type: "string" });
	}],
	handler: async function(args, ctl) {
		await ctl.sendTo("allInstances", new ChatEvent("Console", args.message));
	},
}));

export default async function(context: CtlPluginContext) {
	context.hooks.addCommands.attach(context.plugin.name, async (rootCommand) => {
		rootCommand.add(globalChatCommands);
	});
}
