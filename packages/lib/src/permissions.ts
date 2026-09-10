/**
 * User and permissions library
 *
 * Defines data types for users, roles and permissions.
 *
 * @author Hornwitser
 * @module lib/users
 */
import type { PluginNodeEnvInfo, PluginWebpackEnvInfo } from "./plugin.js";
import { Permission } from "./data/index.js";

export const permissions = new Map<string, Permission>();

/**
 * Registry of known permission names.
 *
 * Plugins add their permissions with module augmentation:
 *
 * ```ts
 * declare module "@clusterio/lib" {
 *     export interface Permissions {
 *         "foo_frobber.frobnicate": never;
 *     }
 * }
 * ```
 *
 * Only the keys matter, the values are always never.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Permissions extends Record<(typeof corePermissions)[number]["name"], never> {}

/** Name of a permission known at compile time, see {@link Permissions}. */
export type PermissionName = keyof Permissions;

/** Definition of a permission, see {@link definePermission}. */
export type PermissionDefinition = {
	/** The internal name for the permission. */
	name: PermissionName,
	/** User facing name for the permission. */
	title: string,
	/** User facing description. */
	description: string,
	/** If true this permission is granted by the generated Player role by default. */
	grantByDefault?: boolean,
};

/**
 * Define a new user permission for Clusterio
 *
 * Defines a permission for use in Clusterio.  Defined permissions can be
 * granted to roles, and checked on users.  Name should be `lower_case`
 * style and start with the plugin name followed by a dot.
 *
 * Plugins should prefer declaring permissions in the `permissions` array
 * of their {@link PluginDeclaration}, which is registered by
 * {@link registerPluginPermissions}.
 *
 * @param def - The definition for the permission.
 */
export function definePermission({
	name,
	title,
	description,
	grantByDefault = false,
}: PermissionDefinition) {
	if (typeof name !== "string" || !name.length) {
		throw new Error("Expected name to be a non-empty string");
	}
	if (typeof title !== "string" || !title.length) {
		throw new Error("Expected title to be a non-empty string");
	}
	if (typeof description !== "string" || !description.length) {
		throw new Error("Expected description to be a non-empty string");
	}
	if (typeof grantByDefault !== "boolean") {
		throw new Error("Expected grantByDefault to be a boolean");
	}

	if (permissions.has(name)) {
		throw new Error(`Permission '${name}' is already defined`);
	}

	permissions.set(name, new Permission(name, title, description, grantByDefault));
}

/**
 * Define all permissions declared by the provided plugin infos
 *
 * @param pluginInfos - Array of plugin info objects.
 */
export function registerPluginPermissions(pluginInfos: PluginNodeEnvInfo[] | PluginWebpackEnvInfo[]) {
	for (const pluginInfo of pluginInfos) {
		for (const permission of pluginInfo.permissions ?? []) {
			if (typeof permission.name !== "string" || !permission.name.startsWith(`${pluginInfo.name}.`)) {
				throw new Error(
					`Expected name of permission '${permission.name}' for ${pluginInfo.name} ` +
					`to start with '${pluginInfo.name}.'`
				);
			}
			definePermission(permission);
		}
	}
}

// Definitions for the built in permissions used in Clusterio.
// description should answer "this permission allows you to ___"
export const corePermissions = [
	{
		name: "core.admin",
		title: "Administrator",
		description: "Bypass all permission checks.",
	},
	{
		name: "core.control.connect",
		title: "Connect to WebSocket",
		description: "Connect to the controller's WebSocket control interface.",
		grantByDefault: true,
	},

	{
		name: "core.controller.stop",
		title: "Stop controller",
		description:
			"Stop the Node.js controller process making the cluster inoperable until someone with access to the " +
			"system it runs on manually starts it again.",
	},
	{
		name: "core.controller.restart",
		title: "Restart controller",
		description: "Restart the Node.js controller process if the system is set up for restarting.",
	},
	{
		name: "core.controller.update",
		title: "Update controller",
		description: "Remotely update the controller if the controller allows for remote updates.",
	},
	{
		name: "core.controller.get_config",
		title: "Get controller config",
		description: "Get the config of controller.",
	},
	{
		name: "core.controller.update_config",
		title: "Modify controller config",
		description: "Modify the controller config or entries of the controller config.",
	},
	{
		name: "core.controller.metrics",
		title: "Scrape metrics",
		description: "Fetch the Prometheus metrics for the cluster from the controller's /metrics endpoint.",
	},
	{
		name: "core.system.subscribe",
		title: "Subscribe to system updates",
		description:
			"Subscribe to be notified when the system info detailing system specific information along with metrics " +
			"such as cpu, memory and disk usage for the controller and hosts are updated.",
	},
	{
		name: "core.host.stop",
		title: "Stop Hosts",
		description:
			"Stop Node.js host processes making the host inaccessible until someone with access to the system " +
			"it runs on manually starts it again.",
	},
	{
		name: "core.host.restart",
		title: "Restart Hosts",
		description: "Restart Node.js host processes if the system they run on are set up for restarting.",
	},
	{
		name: "core.host.update",
		title: "Update Hosts",
		description: "Remotely update a host if the host allows for remote updates.",
	},
	{
		name: "core.host.get_config",
		title: "Get host configs",
		description: "Get the config of hosts.",
	},
	{
		name: "core.host.update_config",
		title: "Modify host configs",
		description: "Modify the host config or entries of the host config.",
	},
	{
		name: "core.host.list",
		title: "List hosts",
		description: "Get the full list of hosts in the cluster.",
		grantByDefault: true,
	},
	{
		name: "core.host.subscribe",
		title: "Subscribe to host updates",
		description: "Subscribe to be notified on updates on the details of hosts.",
		grantByDefault: true,
	},
	{
		name: "core.host.generate_token",
		title: "Generate host token",
		description: "Generate tokens for hosts to connect to the cluster with.",
	},
	{
		name: "core.host.revoke_token",
		title: "Revoke host token",
		description: "Revoke access token and terminate existing connection for hosts.",
	},
	{
		name: "core.host.create_config",
		title: "Create host config",
		description: "Create host configs via the controller.",
	},

	{
		name: "core.instance.get",
		title: "Get instance",
		description: "Get the details of an instance in the cluster.",
		grantByDefault: true,
	},
	{
		name: "core.instance.list",
		title: "List instances",
		description: "Get the full list of instances in the cluster.",
		grantByDefault: true,
	},
	{
		name: "core.instance.subscribe",
		title: "Subscribe to instance updates",
		description: "Subscribe to be notified on updates on the details and status of instances.",
		grantByDefault: true,
	},
	{
		name: "core.instance.create",
		title: "Create instance",
		description: "Create new instances on the controller.",
	},
	{
		name: "core.instance.get_config",
		title: "Get instance config",
		description: "Get the config of instances.",
	},
	{
		name: "core.instance.update_config",
		title: "Modify instance config",
		description: "Modify the config or entries of the config for instances.",
	},
	{
		name: "core.instance.assign",
		title: "Assign instance",
		description: "Assign or reassign instances to a host.",
	},
	{
		name: "core.instance.save.list",
		title: "List saves",
		description: "List the saves currently on instances.",
	},
	{
		name: "core.instance.save.subscribe",
		title: "Subscribe to save updates",
		description: "Subscribe to be notifed on updates to the list of saves of instances.",
	},
	{
		name: "core.instance.save.create",
		title: "Create new save",
		description: "Create new savegames on instances.",
	},
	{
		name: "core.instance.save.rename",
		title: "Rename save",
		description: "Rename savegames on instances.",
	},
	{
		name: "core.instance.save.copy",
		title: "Copy save",
		description: "Create copies of savegames on instances.",
	},
	{
		name: "core.instance.save.delete",
		title: "Delete save",
		description: "Delete savegames on instances.",
	},
	{
		name: "core.instance.save.upload",
		title: "Upload save",
		description: "Upload savegames to instances.",
	},
	{
		name: "core.instance.save.transfer",
		title: "Transfer save",
		description: "Transfer savegames between instances.",
	},
	{
		name: "core.instance.save.download",
		title: "Download save",
		description: "Download savegames from instances.",
	},
	{
		name: "core.instance.export_data",
		title: "Export locale and icons",
		description: "Export the the locale and icons from an instance and upload it to the controller.",
	},
	{
		name: "core.instance.extract_players",
		title: "Extract player stats from running save",
		description:
			"Run extraction to create a user for each player in the save and set the online time from the save.",
	},
	{
		name: "core.instance.start",
		title: "Start instance",
		description: "Start instances.",
	},
	{
		name: "core.instance.restart",
		title: "Restart instance",
		description: "Restart instances.",
	},
	{
		name: "core.instance.load_scenario",
		title: "Load scenario",
		description: "Start instances by loading a scenario.",
	},
	{
		name: "core.instance.stop",
		title: "Stop instance",
		description: "Stop instances.",
	},
	{
		name: "core.instance.kill",
		title: "Kill instance",
		description: "Terminate running instances without saving or cleanup.",
	},
	{
		name: "core.instance.delete",
		title: "Delete instance",
		description: "Delete instances (includes config and all files stored like saves and logs).",
	},
	{
		name: "core.instance.send_rcon",
		title: "Send RCON",
		description: "Send arbitrary RCON commands to instances.",
	},

	{
		name: "core.mod_pack.get",
		title: "Retrieve mod pack",
		description: "Get the details of a mod pack in the cluster.",
		grantByDefault: true,
	},
	{
		name: "core.mod_pack.list",
		title: "List mod packs",
		description: "Get the full list of a mod packs in the cluster.",
		grantByDefault: true,
	},
	{
		name: "core.mod_pack.subscribe",
		title: "Subscribe to mod pack updates",
		description: "Subscribe to be notified on updates on the details of mod packs.",
		grantByDefault: true,
	},
	{
		name: "core.mod_pack.create",
		title: "Create mod pack",
		description: "Create new mod pack in the cluster.",
	},
	{
		name: "core.mod_pack.update",
		title: "Update mod pack",
		description: "Edit existing mod pack definition in the cluster.",
	},
	{
		name: "core.mod_pack.delete",
		title: "Delete mod pack",
		description: "Delete mod pack definition in the cluster.",
	},
	{
		name: "core.mod.get",
		title: "Get mods",
		description: "Get the details of a mod stored in the cluster.",
		grantByDefault: true,
	},
	{
		name: "core.mod.list",
		title: "List mods",
		description: "Get the full list of mods stored on the controller.",
		grantByDefault: true,
	},
	{
		name: "core.mod.search",
		title: "Search mods",
		description: "Search through the list of mods stored on the controller.",
		grantByDefault: true,
	},
	{
		name: "core.mod.search_portal",
		title: "Search mod portal",
		description: "Search for mods on the Factorio mod portal.",
		grantByDefault: true,
	},
	{
		name: "core.mod.subscribe",
		title: "Subscribe to mod updates",
		description: "Subscribe to be notified on updates on the details of mods.",
		grantByDefault: true,
	},
	{
		name: "core.mod.upload",
		title: "Upload mods",
		description: "Upload mods to the controller.",
	},
	{
		name: "core.mod.download",
		title: "Download mod",
		description: "Download mods stored on the controller.",
		grantByDefault: true,
	},
	{
		name: "core.mod.delete",
		title: "Delete mod",
		description: "Delete mods stored on the controller.",
	},
	{
		name: "core.mod.download_from_portal",
		title: "Download mods from portal",
		description: "Allow downloading mods directly from the Factorio mod portal to the controller.",
		grantByDefault: true,
	},

	{
		name: "core.permission.list",
		title: "List permissions",
		description: "Get the full list of permissions in the cluster.",
		grantByDefault: true,
	},

	{
		name: "core.role.list",
		title: "List roles",
		description: "Get the full list of roles and their permissions in the cluster.",
		grantByDefault: true,
	},
	{
		name: "core.role.subscribe",
		title: "Subscribe to role updates",
		description: "Subscribe to be notified on updates on the details of roles.",
		grantByDefault: true,
	},
	{
		name: "core.role.create",
		title: "Create role",
		description: "Create new roles with permissions.",
	},
	{
		name: "core.role.update",
		title: "Update role",
		description: "Edit existing roles including permissions they grant.",
	},
	{
		name: "core.role.delete",
		title: "Delete role",
		description: "Permanently delete roles.",
	},

	{
		name: "core.user.get",
		title: "Get user",
		description: "Get the details of a user in the cluster.",
		grantByDefault: true,
	},
	{
		name: "core.user.list",
		title: "List users",
		description: "Get the full list of users in the cluster.",
		grantByDefault: true,
	},
	{
		name: "core.user.subscribe",
		title: "Subscribe to user updates",
		description: "Subscribe to be notified on updates on the details and status of users.",
		grantByDefault: true,
	},
	{
		name: "core.user.create",
		title: "Create users",
		description: "Create user acounts with a given name.",
	},
	{
		name: "core.user.revoke_token",
		title: "Revoke user token",
		description: "Revoke access token and terminate all existing control connections for oneself.",
		grantByDefault: true,
	},
	{
		name: "core.user.revoke_other_token",
		title: "Revoke other user's token",
		description: "Allow revoking tokens for other users than oneself. Requires Revoke user token.",
	},
	{
		name: "core.user.update_roles",
		title: "Update user roles",
		description: "Add or remove any role to any user.",
	},
	{
		name: "core.user.set_admin",
		title: "Set user admin status",
		description: "Promote or demote any user to Factorio admin.",
	},
	{
		name: "core.user.set_banned",
		title: "Set user ban status",
		description: "Ban or unban any user.",
	},
	{
		name: "core.user.set_whitelisted",
		title: "Set user whitelist status",
		description: "Add or remove any user to/from the whitelist.",
	},
	{
		name: "core.user.delete",
		title: "Delete user",
		description: "Delete users and all data stored for them.",
	},
	{
		name: "core.user.bulk_import",
		title: "Bulk user import",
		description: "Bulk import users including admin, whitelist, and bans." +
		" (Imports types are restricted by other permissions, e.g. core.user.set_admin)",
	},
	{
		name: "core.user.bulk_export",
		title: "Bulk user export",
		description: "Bulk export users including admin, whitelist, and bans.",
	},
	{
		name: "core.user.bulk_restore",
		title: "Bulk user restore",
		description: "Bulk restore users including admin, whitelist, and bans." +
		" (Restore types are restricted by other permissions, e.g. core.user.set_admin)",
	},

	{
		name: "core.log.follow",
		title: "Follow cluster log",
		description: "Receive new entries in the cluster log.  Required to see instance console.",
	},
	{
		name: "core.log.query",
		title: "Query cluster log",
		description: "Query past entries in the cluster log.  Required to see past entries in instance console.",
	},

	{
		name: "core.plugin.list",
		title: "List plugins",
		description: "List all installed plugins on a machine.",
	},
	{
		name: "core.plugin.update",
		title: "Update plugin",
		description: "Remotely update a plugin if the target allows remote updates of plugins.",
	},
	{
		name: "core.plugin.install",
		title: "Install plugin",
		description: "Remotely install a plugin if the target allows remote installs of plugins.",
	},

	{
		name: "core.debug.dump_ws",
		title: "Dump WebSocket",
		description: "Dump all WebSocket communicatation from the controller.",
	},

	{
		name: "core.external.get_factorio_versions",
		title: "Get factorio versions",
		description: "Get list of all factorio versions from Wube",
	},

	{
		name: "core.external.get_latest_releases",
		title: "Get factorio releases",
		description: "Get the latest stable and experimental factorio releases from Wube",
	},
] as const satisfies readonly {
	name: string,
	title: string,
	description: string,
	grantByDefault?: boolean,
}[];

for (const permission of corePermissions) {
	definePermission(permission);
}
