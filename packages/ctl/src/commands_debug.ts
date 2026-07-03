import * as lib from "@clusterio/lib";
import type { Control } from "../ctl";

export const debugCommands = new lib.CommandTree({ name: "debug", description: "Debugging utilities" });
debugCommands.add(new lib.Command({
	definition: ["dump-ws", "Dump WebSocket messages sent and received by controller"],
	handler: async function(args: object, control: Control) {
		await control.send(new lib.DebugDumpWsRequest());
		control.keepOpen = true;
	},
}));

debugCommands.add(new lib.Command({
	definition: [
		"parse-exchange-string <exchange-string>",
		"Parse and print the contents of an exchange string",
		(yargs) => {
			yargs.positional("exchange-string", { describe: "String to parse", type: "string" });
			yargs.option("pretty", { alias: "p", type: "boolean", description: "Pretty output" });
		}],
	handler: async function(args: { exchangeString: string, pretty: boolean }, control: Control) {
		const result = lib.readMapExchangeString(args.exchangeString);
		if (args.pretty) {
			// eslint-disable-next-line no-console
			console.log(JSON.stringify(result, null, 2));
		} else {
			// eslint-disable-next-line no-console
			console.log(JSON.stringify(result));
		}
	},
}));
