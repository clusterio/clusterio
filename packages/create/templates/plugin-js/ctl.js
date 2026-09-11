"use strict";
const { CommandTree, Command } = require("@clusterio/lib");
//%// We do not check for multi context here because it doesn't make sense to have a ctl without messages
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
module.exports.default = async function loadCtlPlugin(context) {
	context.hooks.addCommands.attach(context.plugin.name, async (rootCommand) => {
		rootCommand.add(pluginCommands);
	});
};
