import * as lib from "@clusterio/lib";
import type { Ctl } from "../ctl.js";

export const permissionCommands = new lib.CommandTree({ name: "permission", description: "Permission inspection" });
permissionCommands.add(new lib.Command({
	definition: [["list", "l"], "List permissions in the cluster"],
	handler: async function(args: object, ctl: Ctl) {
		ctl.output.table(await ctl.send(new lib.PermissionListRequest()));
	},
}));
