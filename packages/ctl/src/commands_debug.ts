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
