import fs from "fs-extra";
import asTableModule from "as-table";
import path from "path";

import * as lib from "@clusterio/lib";
import type { Control } from "../ctl";
import { print } from "./command_ops";

const asTable = asTableModule.configure({ delimiter: " | " });

export const userCommands = new lib.CommandTree({ name: "user", alias: ["u"], description: "User management" });
userCommands.add(new lib.Command({
	definition: ["show <name>", "Show details for one user", (yargs) => {
		yargs.positional("name", { decribe: "Name of user to show", type: "string" });
		yargs.options({
			"instance-stats": { describe: "include per-instance stats", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: { name: string, instanceStats: boolean }, control: Control) {
		let user = await control.send(new lib.UserGetRequest(args.name));
		Object.assign(user, user.playerStats);
		// @ts-expect-error Terrible hack
		delete user.playerStats;
		let instanceStats = user.instanceStats;
		// @ts-expect-error Terrible hack
		delete user.instanceStats;
		print(asTable(Object.entries(user).map(([property, value]) => ({ property, value }))));

		if (args.instanceStats) {
			let instances = await control.send(new lib.InstanceDetailsListRequest());
			function instanceName(id: number) {
				let instance = instances.find(i => i.id === id);
				if (instance) {
					return instance.name;
				}
				return "<deleted>";
			}
			for (let [id, playerInstanceStats] of instanceStats || []) {
				print();
				print(`Instance ${instanceName(id)} (${id}):`);
				print(asTable(Object.entries(playerInstanceStats).map(([property, value]) => ({ property, value }))));
			}
		}
	},
}));

userCommands.add(new lib.Command({
	definition: [["list", "l"], "List user in the cluster", (yargs) => {
		yargs.options({
			"stats": { describe: "include user stats", nargs: 0, type: "boolean", default: false },
			"attributes": { describe: "include admin/whitelisted/banned", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: { stats: boolean, attributes: boolean }, control: Control) {
		let users = await control.send(new lib.UserListRequest());
		for (let user of users) {
			if (args.stats) {
				Object.assign(user, user.playerStats);
			}
			// @ts-expect-error Terrible hack
			delete user.playerStats;
			// @ts-expect-error Terrible hack
			delete user.isDeleted;
			// @ts-expect-error Terrible hack
			delete user.banReason;
			// @ts-expect-error Terrible hack
			delete user.instanceStats;
			if (!args.attributes) {
				// @ts-expect-error Terrible hack
				delete user.isAdmin;
				// @ts-expect-error Terrible hack
				delete user.isWhitelisted;
				// @ts-expect-error Terrible hack
				delete user.isBanned;
			}
		}
		print(asTable(users));
	},
}));

userCommands.add(new lib.Command({
	definition: ["create <name>", "Create a user", (yargs) => {
		yargs.positional("name", { describe: "Name of user to create", type: "string" });
	}],
	handler: async function(args: { name: string }, control: Control) {
		await control.send(new lib.UserCreateRequest(args.name));
	},
}));

userCommands.add(new lib.Command({
	definition: ["revoke-token <name>", "Revoke token for user", (yargs) => {
		yargs.positional("name", { describe: "Name of user to revoke token for", type: "string" });
	}],
	handler: async function(args: { name: string }, control: Control) {
		await control.send(new lib.UserRevokeTokenRequest(args.name));
	},
}));

userCommands.add(new lib.Command({
	definition: ["set-admin <user>", "Promote or demote a user to admin", (yargs) => {
		yargs.positional("user", { describe: "Name of user set admin status for", type: "string" });
		yargs.options({
			"revoke": { describe: "Revoke admin status", nargs: 0, type: "boolean", default: false },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: { user: string, revoke: boolean, create: boolean }, control: Control) {
		await control.send(new lib.UserSetAdminRequest(args.user, args.create, !args.revoke));
	},
}));

userCommands.add(new lib.Command({
	definition: ["set-whitelisted <user>", "Add or remove user from the whitelist", (yargs) => {
		yargs.positional("user", { describe: "Name of user to set whitelist status for", type: "string" });
		yargs.options({
			"remove": { describe: "Remove from whitelist", nargs: 0, type: "boolean", default: false },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: { user: string, remove: boolean, create: boolean }, control: Control) {
		await control.send(new lib.UserSetWhitelistedRequest(args.user, args.create, !args.remove));
	},
}));

userCommands.add(new lib.Command({
	definition: ["set-banned <user>", "Ban or pardon user from banlist", (yargs) => {
		yargs.positional("user", { describe: "Name of user to set ban status for", type: "string" });
		yargs.options({
			"pardon": { describe: "Remove from banlist", nargs: 0, type: "boolean", default: false },
			"reason": { describe: "Ban reason", nargs: 1, type: "string", default: "" },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(
		args: {
			user: string,
			pardon: boolean,
			reason: string,
			create: boolean
		},
		control: Control
	) {
		await control.send(new lib.UserSetBannedRequest(args.user, args.create, !args.pardon, args.reason));
	},
}));

userCommands.add(new lib.Command({
	definition: ["set-roles <user> [roles...]", "Replace user roles", (yargs) => {
		yargs.positional("user", { describe: "Name of user to change roles for", type: "string" });
		yargs.positional("roles", { describe: "roles to assign", type: "string" });
	}],
	handler: async function(args: { user: string, roles: string[] }, control: Control) {
		let roles = await control.send(new lib.RoleListRequest());

		let resolvedRoles = [];
		for (let roleName of args.roles) {
			if (/^-?\d+$/.test(roleName)) {
				let roleId = parseInt(roleName, 10);
				resolvedRoles.push(roleId);

			} else {
				let found = false;
				for (let role of roles) {
					if (role.name === roleName) {
						resolvedRoles.push(role.id);
						found = true;
						break;
					}
				}

				if (!found) {
					throw new lib.CommandError(`No role named ${roleName}`);
				}
			}
		}

		await control.send(new lib.UserUpdateRolesRequest(args.user, resolvedRoles));
	},
}));

userCommands.add(new lib.Command({
	definition: ["delete <user>", "Delete user", (yargs) => {
		yargs.positional("user", { describe: "Name of user to delete", type: "string" });
	}],
	handler: async function(args: { user: string }, control: Control) {
		await control.send(new lib.UserDeleteRequest(args.user));
	},
}));

async function handleImportOrRestore(args: {
	filepath: string,
	users: boolean,
	bans: boolean,
	admins: boolean,
	whitelist: boolean,
	noBackup?: boolean,
}, control: Control, restore: boolean) {
	let importType: ConstructorParameters<typeof lib.UserBulkImportRequest>[0];
	const data = JSON.parse((await fs.readFile(args.filepath)).toString());
	const optionCount = [args.users, args.bans, args.admins, args.whitelist]
		.reduce((acc, bool) => (bool ? acc + 1 : acc), 0);

	if (optionCount > 1) {
		throw new lib.CommandError("Can not specify multiple options");
	}

	// Assign based on options or attempt to guess based on filename
	const filename = path.basename(args.filepath);
	if (args.users || (optionCount === 0 && data.export_version)) {
		importType = "users";
	} else if (args.bans || (optionCount === 0 && filename.includes("ban"))) {
		importType = "bans";
	} else if (args.admins || (optionCount === 0 && filename.includes("admin"))) {
		importType = "admins";
	} else if (args.whitelist || (optionCount === 0 && filename.includes("whitelist"))) {
		importType = "whitelist";
	} else {
		throw new lib.CommandError("Unknown json file, please specify an option");
	}

	const backup = await control.send(
		new lib.UserBulkImportRequest(importType, importType === "users" ? data.users : data, restore)
	);

	print(`${restore ? "Restored" : "Imported"} ${importType} from ${args.filepath}`);
	if (restore && backup && !args.noBackup) {
		await fs.writeJSON(`${importType}-backup.json`, backup, { spaces: 2 });
		print(`Wrote backup to ${importType}-backup.json`);
	}
}

userCommands.add(new lib.Command({
	definition: ["import <filepath>", "Import user data from a file", (yargs) => {
		yargs.positional("filepath", { describe: "Path to the file to import", type: "string" });
		yargs.options({
			"users": { describe: "Import users json", nargs: 0, type: "boolean", default: false },
			"bans": { describe: "Import banlist json", nargs: 0, type: "boolean", default: false },
			"admins": { describe: "Import adminlist json", nargs: 0, type: "boolean", default: false },
			"whitelist": { describe: "Import whitelist json", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: any, control: any) {
		await handleImportOrRestore(args, control, false);
	},
}));

userCommands.add(new lib.Command({
	definition: ["restore <filepath>", "Restore user data from a file", (yargs) => {
		yargs.positional("filepath", { describe: "Path to the file to import", type: "string" });
		yargs.options({
			"users": { describe: "Restore users json", nargs: 0, type: "boolean", default: false },
			"bans": { describe: "Restore banlist json", nargs: 0, type: "boolean", default: false },
			"admins": { describe: "Restore adminlist json", nargs: 0, type: "boolean", default: false },
			"whitelist": { describe: "Restore whitelist json", nargs: 0, type: "boolean", default: false },
			"no-backup": { describe: "Don't save a backup to the cwd", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: any, control: any) {
		await handleImportOrRestore(args, control, true);
	},
}));

userCommands.add(new lib.Command({
	definition: ["export <filepath>", "Export user data to a file", (yargs) => {
		yargs.positional("filepath", { describe: "Path to the file to save to", type: "string" });
		yargs.options({
			"users": { describe: "Export users json", nargs: 0, type: "boolean", default: false },
			"bans": { describe: "Export banlist json", nargs: 0, type: "boolean", default: false },
			"admins": { describe: "Export adminlist json", nargs: 0, type: "boolean", default: false },
			"whitelist": { describe: "Export whitelist json", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: {
		filepath: string,
		users: boolean,
		bans: boolean,
		admins: boolean,
		whitelist: boolean,
	}, control: Control) {
		let exportType = "users" as ConstructorParameters<typeof lib.UserBulkExportRequest>[0];
		const optionCount = [args.bans, args.admins, args.whitelist]
			.reduce((acc, bool) => (bool ? acc + 1 : acc), 0);

		if (optionCount > 1) {
			throw new lib.CommandError("Can not specify multiple options");
		}

		// Assign based on options or attempt to guess based on filename
		if (args.users) {
			exportType = "users";
		} else if (args.bans) {
			exportType = "bans";
		} else if (args.admins) {
			exportType = "admins";
		} else if (args.whitelist) {
			exportType = "whitelist";
		}

		await fs.writeJSON(args.filepath, await control.send(
			new lib.UserBulkExportRequest(exportType)
		), { spaces: 2 });
		print(`Exported ${exportType} to ${args.filepath}`);
	},
}));
