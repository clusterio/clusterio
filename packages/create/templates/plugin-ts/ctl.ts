type Control = any; // import type { Control } from "@clusterio/ctl";
import { BaseCtlPlugin } from "@clusterio/ctl";
import { CommandTree, Command } from "@clusterio/lib";
import { PluginExampleEvent, PluginExampleRequest } from "./messages";
/* eslint-disable no-console */

const pluginCommands = new CommandTree({
	name: "// plugin_name //", description: "The default description I forgot to change",
});

pluginCommands.add(new Command({
	definition: ["my-command <foo>", "My command description that I really should change", (yargs) => {
		yargs.positional("foo", { describe: "foo is foo!", type: "string" });
	}],
	handler: async function(args: { foo: string }, control: Control) {
		await control.sendTo("controller", new PluginExampleEvent(args.foo, [1, 2, 3]));
		console.log(args);
	},
}));

/* eslint-enable no-console */
export class CtlPlugin extends BaseCtlPlugin {
	async addCommands(rootCommand: CommandTree) {
		rootCommand.add(pluginCommands);
	}
}
