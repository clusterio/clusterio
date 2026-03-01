import asTableModule from "as-table";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";
import type { Control } from "../ctl";
import { print } from "./command_ops";

const asTable = asTableModule.configure({ delimiter: " | " });

export const roleCommands = new lib.CommandTree({ name: "role", description: "Role management" });
roleCommands.add(new lib.Command({
	definition: [["list", "l"], "List roles in the cluster"],
	handler: async function(args: object, control: Control) {
		let roles = await control.send(new lib.RoleListRequest());
		print(asTable(roles));
	},
}));

roleCommands.add(new lib.Command({
	definition: ["create <name>", "Create a new role", (yargs) => {
		yargs.positional("name", { describe: "Name of role to create", type: "string" });
		yargs.options({
			"description": { describe: "Description for role", nargs: 1, type: "string", default: "" },
			"permissions": { describe: "Permissions role grants", nargs: 1, array: true, type: "string", default: [] },
		});
	}],
	handler: async function(args: { name: string, description: string, permissions: string[] }, control: Control) {
		let id = await control.send(new lib.RoleCreateRequest(
			args.name,
			args.description,
			args.permissions,
		));
		logger.info(`Created role ID ${id}`);
	},
}));

roleCommands.add(new lib.Command({
	definition: ["edit <role>", "Edit existing role", (yargs) => {
		yargs.positional("role", { describe: "Role to edit", type: "string" });
		yargs.options({
			"name": { describe: "New name for role", nargs: 1, type: "string" },
			"description": { describe: "New description for role", nargs: 1, type: "string" },
			"set-perms": { describe: "Set permissions for role", array: true, type: "string" },
			"add-perms": { describe: "Add permissions to role", array: true, type: "string", conflicts: "set-perms" },
			"remove-perms": {
				describe: "Remove permissions from role", array: true, type: "string", conflicts: "set-perms",
			},
			"grant-default": { describe: "Add default permissions to role", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(
		args: {
			role: string,
			name?: string,
			description?: string,
			setPerms?: string[],
			addPerms?: string[],
			removePerms?: string[],
			grantDefault?: boolean,
		},
		control: Control
	) {
		let role = await lib.retrieveRole(control, args.role);

		if (args.name !== undefined) {
			role.name = args.name;
		}
		if (args.description !== undefined) {
			role.description = args.description;
		}
		if (args.addPerms) {
			for (const perm of args.addPerms) {
				role.permissions.add(perm);
			}
		}
		if (args.removePerms) {
			for (let perm of args.removePerms) {
				role.permissions.delete(perm);
			}
		}
		if (args.setPerms !== undefined) {
			role.permissions = new Set(args.setPerms);
		}
		await control.send(new lib.RoleUpdateRequest(role.id, role.name, role.description, [...role.permissions]));

		if (args.grantDefault) {
			await control.send(new lib.RoleGrantDefaultPermissionsRequest(role.id));
		}
	},
}));

roleCommands.add(new lib.Command({
	definition: ["delete <role>", "Delete role", (yargs) => {
		yargs.positional("role", { describe: "Role to delete", type: "string" });
	}],
	handler: async function(args: { role: string }, control: Control) {
		let role = await lib.retrieveRole(control, args.role);
		await control.send(new lib.RoleDeleteRequest(role.id));
	},
}));
