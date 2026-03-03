import asTableModule from "as-table";

import * as lib from "@clusterio/lib";
import type { Control } from "../ctl";
import { print } from "./command_ops";

const asTable = asTableModule.configure({ delimiter: " | " });

export const permissionCommands = new lib.CommandTree({ name: "permission", description: "Permission inspection" });
permissionCommands.add(new lib.Command({
	definition: [["list", "l"], "List permissions in the cluster"],
	handler: async function(args: object, control: Control) {
		let permissions = await control.send(new lib.PermissionListRequest());
		print(asTable(permissions));
	},
}));
