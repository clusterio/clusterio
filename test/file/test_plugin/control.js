import { Command, CommandTree } from "@clusterio/lib";
import { BaseCtlPlugin } from "@clusterio/ctl";

const testPluginCommands = new CommandTree({
	name: "test-plugin", description: "Test plugin commands",
});
testPluginCommands.add(new Command({
	definition: ["echo <message>", "Print the message given to it", (yargs) => {
		yargs.positional("message", { describe: "message to print", type: "string" });
	}],
	handler: async function(args, control) {
		// eslint-disable-next-line no-console
		console.log(args.message);
	},
}));

export class CtlPlugin extends BaseCtlPlugin {
	async addCommands(rootCommand) {
		rootCommand.add(testPluginCommands);
	}
}
