import asTableModule from "as-table";

import * as lib from "@clusterio/lib";
import type { Ctl } from "../ctl.js";
import { print } from "./command_ops.js";

const asTable = asTableModule.configure({ delimiter: " | " });

export const permissionCommands = new lib.CommandTree({ name: "permission", description: "Permission inspection" });
permissionCommands.add(new lib.Command({
	definition: [["list", "l"], "List permissions in the cluster"],
	handler: async function(args: object, ctl: Ctl) {
		let permissions = await ctl.send(new lib.PermissionListRequest());
		print(asTable(permissions));
	},
}));
