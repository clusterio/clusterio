"use strict";
const { Command, CommandTree } = require("@clusterio/lib");
const { BaseCtlPlugin } = require("@clusterio/ctl");

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

class CtlPlugin extends BaseCtlPlugin {
	async addCommands(rootCommand) {
		rootCommand.add(testPluginCommands);
	}
}

module.exports = {
	CtlPlugin,
};
