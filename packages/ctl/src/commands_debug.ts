import * as lib from "@clusterio/lib";
import type { Ctl } from "../ctl.js";
import { print } from "./command_ops.js";

export const debugCommands = new lib.CommandTree({ name: "debug", description: "Debugging utilities" });
debugCommands.add(new lib.Command({
	definition: ["dump-ws", "Dump WebSocket messages sent and received by controller"],
	handler: async function(args: object, ctl: Ctl) {
		await ctl.send(new lib.DebugDumpWsRequest());
		ctl.keepOpen = true;
		ctl.output.streamingLog = true;
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
	handler: async function(args: { exchangeString: string, pretty: boolean }, ctl: Ctl) {
		const result = lib.readMapExchangeString(args.exchangeString);
		ctl.output.result(result, () => print(JSON.stringify(result, null, args.pretty ? 2 : undefined)));
	},
}));
