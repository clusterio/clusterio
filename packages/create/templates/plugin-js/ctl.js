"use strict";
const { BaseCtlPlugin } = require("@clusterio/ctl");
const { CommandTree, Command } = require("@clusterio/lib");
const { PluginExampleEvent, PluginExampleRequest } = require("./messages");
/* eslint-disable no-console */

const pluginCommands = new CommandTree({
	name: "__plugin_name__", description: "The default description I forgot to change",
});

pluginCommands.add(new Command({
	definition: ["my-command <foo>", "My command description that I really should change", (yargs) => {
		yargs.positional("foo", { describe: "foo is foo!", type: "string" });
	}],
	handler: async function(args, control) {
		const response = await control.sendTo("controller", new PluginExampleRequest(args.foo, [1, 2, 3]));
		console.log(response);
		console.log(args);
	},
}));

/* eslint-enable no-console */
class CtlPlugin extends BaseCtlPlugin {
	async addCommands(rootCommand) {
		rootCommand.add(pluginCommands);
	}
}

module.exports = {
	CtlPlugin,
};
