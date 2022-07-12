/**
 * User and permissions library
 *
 * Defines data types for users, roles and permissions.
 *
 * @author Hornwitser
 * @module lib/users
 */
"use strict";
const jwt = require("jsonwebtoken");

const libErrors = require("./errors");

const PlayerStats = require("./PlayerStats");


/**
 * Represents a permission that can be granted
 * @static
 */
class Permission {
	constructor(name, title, description, grantByDefault) {
		this.name = name;
		this.title = title;
		this.description = description;
		this.grantByDefault = grantByDefault;
	}
}
const permissions = new Map();

/**
 * Define a new user permission for Clusterio
 *
 * Defines a permission for use in Clusterio.  Defined permissions can be
 * granted to roles, and checked on users.  Name should be `lower_case`
 * style and start with the plugin name followed by a dot.
 *
 * @param {Object} def - The definition for the permission.
 * @param {string} def.name - The internal name for the permission.
 * @param {string} def.title - User facing name for permission.
 * @param {string} def.description - User facing description.
 * @param {boolean} def.grantByDefault -
 *     If true this role is granted by the generated Player role by default.
 *
 */
function definePermission({ name, title, description, grantByDefault=false }) {
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
 * Represents a collection of granted permissions
 * @static
 */
class Role {
	constructor(serializedRole) {
		this.id = serializedRole.id;
		this.name = serializedRole.name;
		this.description = serializedRole.description;
		this.permissions = new Set(serializedRole.permissions);
	}

	serialize() {
		return {
			id: this.id,
			name: this.name,
			description: this.description,
			permissions: [...this.permissions],
		};
	}

	grantDefaultPermissions() {
		for (let permission of permissions.values()) {
			if (permission.grantByDefault) {
				this.permissions.add(permission.name);
			}
		}
	}
}


/**
 * Ensure the default admin role has full access
 *
 * Ensures the role with id 0 exisits and has the core.admin permission.
 *
 * @param {Map<number, module:lib/user.Role>} roles - role storage to modify.
 * @returns {module:lib/permission.Role} the default admin role
 * @static
 */
function ensureDefaultAdminRole(roles) {
	let admin = roles.get(0);
	if (!admin) {
		admin = new Role({ id: 0, name: "Cluster Admin", description: "Cluster wide administrator." });
		roles.set(0, admin);
	}
	admin.permissions.add("core.admin");
	return admin;
}

/**
 * Ensure the default player role has default accesses
 *
 * Ensures the role with id 1 exists and has all the permissions that are
 * assigned by default.  Note that this may not be the same role as the one
 * that is assigned to new users by default.
 *
 * @param {Map<number, module:lib/user.Role>} roles - role storage to modify.
 * @static
 */
function ensureDefaultPlayerRole(roles) {
	let player = roles.get(1);
	if (!player) {
		player = new Role({ id: 1, name: "Player", description: "Default player role." });
		roles.set(1, player);
	}
	player.grantDefaultPermissions();
}


/**
 * Represeents a user in the cluster
 *
 * Holds data about a Factorio user in the cluster.
 * @static
 */
class User {
	constructor(serializedUser, loadedRoles) {
		/**
		 * Factorio user name.
		 * @type {string}
		 */
		this.name = serializedUser.name;

		/**
		 * Instances this user is online on.
		 * @type {Set<number>}
		 */
		this.instances = new Set();

		/**
		 * Unix time in seconds the user token must be issued after to be valid.
		 * @type {number}
		 */
		this.tokenValidAfter = serializedUser.token_valid_after || 0;

		/**
		 * True if the user is promoted to admin on the Factorio instances.
		 * @type {boolean}
		 */
		this.isAdmin = Boolean(serializedUser.is_admin);

		/**
		 * True if the user is whitelisted on the Factorio instances.
		 * @type {boolean}
		 */
		this.isWhitelisted = Boolean(serializedUser.is_whitelisted);

		/**
		 * True if the user is banned from Factorio instances.
		 * @type {boolean}
		 */
		this.isBanned = Boolean(serializedUser.is_banned);

		/**
		 * Reason for being banned.  Ignored if isBanned is false.
		 * @type {string}
		 */
		this.banReason = serializedUser.ban_reason || "";

		/**
		 * Roles this user has
		 * @type {Set<module:lib/permissions.Role>}
		 */
		this.roles = new Set();
		if (serializedUser.roles) {
			for (let roleId of serializedUser.roles) {
				let role = loadedRoles.get(roleId);
				if (role) {
					this.roles.add(role);
				}
			}
		}

		/**
		 * Per instance statistics for the player this user account is tied to.
		 * @type {Map<number, module:lib/PlayerStats>}
		 */
		this.instanceStats = new Map(
			(serializedUser.instance_stats ? serializedUser.instance_stats : []).map(
				([id, stats]) => [id, new PlayerStats(stats)]
			)
		);

		/**
		 * Combined statistics for the player this user account is tied to.
		 * @type {module:lib/PlayerStats}
		 */
		this.playerStats = this._calculatePlayerStats();

		/**
		 * True if this user object has been removed from the cluster.
		 * @type {boolean}
		 */
		this.isDeleted = false;
	}

	serialize() {
		let serialized = {
			name: this.name,
		};

		if (this.roles.size) {
			serialized.roles = [...this.roles].map(role => role.id);
		}

		if (this.tokenValidAfter) {
			serialized.token_valid_after = this.tokenValidAfter;
		}

		if (this.isAdmin) {
			serialized.is_admin = true;
		}

		if (this.isWhitelisted) {
			serialized.is_whitelisted = true;
		}

		if (this.isBanned) {
			serialized.is_banned = true;
		}

		if (this.banReason) {
			serialized.ban_reason = this.banReason;
		}

		if (this.instanceStats.size) {
			serialized.instance_stats = [...this.instanceStats].map(([id, stats]) => [id, stats.toJSON()]);
		}

		return serialized;
	}

	/**
	 * Generate access token for this user
	 *
	 * @param {string} secret - Secret to sign token with.
	 * @returns {string} JWT access token for the user.
	 */
	createToken(secret) {
		return jwt.sign({ aud: "user", user: this.name }, Buffer.from(secret, "base64"));
	}

	/**
	 * Invalidate current tokens for the user
	 *
	 * Sets the tokenValidAfter property to the current time, which causes
	 * all currently issued tokens for the user to become invalid.
	 */
	invalidateToken() {
		this.tokenValidAfter = Math.floor(Date.now() / 1000);
	}

	/**
	 * Check if a given permission is granted
	 *
	 * Checks the roles the user is member of for one that grants the given
	 * permission.  If the permission is not granted for the user a
	 * "Permission denied" error is thrown.
	 *
	 * @param {string} permission - The permission to check for.
	 * @throws {Error} If the given permission does not exist.
	 * @throws {module:lib/errors.PermissionError} if the user does noh have the given permission.
	 */
	checkPermission(permission) {
		if (!permissions.has(permission)) {
			throw new Error(`permission ${permission} does not exist`);
		}

		for (let role of this.roles) {
			if (role.permissions.has("core.admin") || role.permissions.has(permission)) {
				return;
			}
		}

		throw new libErrors.PermissionError("Permission denied");
	}

	notifyJoin(instance_id) {
		this.instances.add(instance_id);
		User.onlineUsers.add(this);
	}

	notifyLeave(instance_id) {
		this.instances.delete(instance_id);
		if (!this.instances.size) {
			User.onlineUsers.delete(this);
		}
	}

	recalculatePlayerStats() {
		this.playerStats = this._calculatePlayerStats();
	}

	_calculatePlayerStats() {
		let playerStats = new PlayerStats();
		for (let instanceStats of this.instanceStats.values()) {
			if (!playerStats.lastJoinAt || instanceStats.lastJoinAt > playerStats.lastJoinAt) {
				playerStats.lastJoinAt = instanceStats.lastJoinAt;
			}
			if (!playerStats.lastLeaveAt || instanceStats.lastLeaveAt > playerStats.lastLeaveAt) {
				playerStats.lastLeaveAt = instanceStats.lastLeaveAt;
				playerStats.lastLeaveReason = instanceStats.lastLeaveReason;
			}
			playerStats.joinCount += instanceStats.joinCount;
			playerStats.onlineTimeMs += instanceStats.onlineTimeMs;
		}
		return playerStats;
	}
}
/**
 * Set of users currently online in the cluster.
 * @type {module:lib/users.User}
 */
User.onlineUsers = new Set();

// Definitions for the built in permissions used in Clusterio.
// description should answer "this permission allows you to ___"
definePermission({
	name: "core.admin",
	title: "Administrator",
	description: "Bypass all permission checks.",
});
definePermission({
	name: "core.control.connect",
	title: "Connect to WebSocket",
	description: "Connect to the master's WebSocket control interface.",
	grantByDefault: true,
});

definePermission({
	name: "core.master.get_config",
	title: "Get master config",
	description: "Get the config of master.",
});
definePermission({
	name: "core.master.update_config",
	title: "Modify master config",
	description: "Modify the master config or entries of the master config.",
});
definePermission({
	name: "core.slave.list",
	title: "List slaves",
	description: "Get the full list of slaves in the cluster.",
	grantByDefault: true,
});
definePermission({
	name: "core.slave.subscribe",
	title: "Subscribe to slave updates",
	description: "Subscribe to be notified on updates on the details of slaves.",
	grantByDefault: true,
});
definePermission({
	name: "core.slave.generate_token",
	title: "Generate slave token",
	description: "Generate tokens for slaves to connect to the cluster with.",
});
definePermission({
	name: "core.slave.create_config",
	title: "Create slave config",
	description: "Create slave configs via the master server.",
});

definePermission({
	name: "core.instance.get",
	title: "Get instance",
	description: "Get the details of an instance in the cluster.",
	grantByDefault: true,
});
definePermission({
	name: "core.instance.list",
	title: "List instances",
	description: "Get the full list of instances in the cluster.",
	grantByDefault: true,
});
definePermission({
	name: "core.instance.subscribe",
	title: "Subscribe to instance updates",
	description: "Subscribe to be notified on updates on the details and status of instances.",
	grantByDefault: true,
});
definePermission({
	name: "core.instance.create",
	title: "Create instance",
	description: "Create new instances on the master server.",
});
definePermission({
	name: "core.instance.get_config",
	title: "Get instance config",
	description: "Get the config of instances.",
});
definePermission({
	name: "core.instance.update_config",
	title: "Modify instance config",
	description: "Modify the config or entries of the config for instances.",
});
definePermission({
	name: "core.instance.assign",
	title: "Assign instance",
	description: "Assign or reassign instances to a slave.",
});
definePermission({
	name: "core.instance.save.list",
	title: "List saves",
	description: "List the saves currently on the instance.",
});
definePermission({
	name: "core.instance.save.list_subscribe",
	title: "Subscribe to save list updatess",
	description: "Subscribe to be notifed on updates to the list of saves of instances.",
});
definePermission({
	name: "core.instance.save.create",
	title: "Create new save",
	description: "Create new savegames on instances.",
});
definePermission({
	name: "core.instance.save.rename",
	title: "Rename save",
	description: "Rename savegames on instances.",
});
definePermission({
	name: "core.instance.save.copy",
	title: "Copy save",
	description: "Create copies of savegames on instances.",
});
definePermission({
	name: "core.instance.save.delete",
	title: "Delete save",
	description: "Delete savegames on instances.",
});
definePermission({
	name: "core.instance.save.upload",
	title: "Upload save",
	description: "Upload savegames to instances.",
});
definePermission({
	name: "core.instance.save.transfer",
	title: "Transfer save",
	description: "Transfer savegames between instances.",
});
definePermission({
	name: "core.instance.save.download",
	title: "Download save",
	description: "Download savegames from instances.",
});
definePermission({
	name: "core.instance.export_data",
	title: "Export locale and icons",
	description: "Export the the locale and icons from an instance and upload it to the master.",
});
definePermission({
	name: "core.instance.start",
	title: "Start instance",
	description: "Start instances.",
});
definePermission({
	name: "core.instance.load_scenario",
	title: "Load scenario",
	description: "Start instances by loading a scenario.",
});
definePermission({
	name: "core.instance.stop",
	title: "Stop instance",
	description: "Stop instances.",
});
definePermission({
	name: "core.instance.kill",
	title: "Kill instance",
	description: "Terminate running instances without saving or cleanup.",
});
definePermission({
	name: "core.instance.delete",
	title: "Delete instance",
	description: "Delete instances (includes config and all files stored like saves and logs).",
});
definePermission({
	name: "core.instance.send_rcon",
	title: "Send RCON",
	description: "Send arbitrary RCON commands to instances.",
});

definePermission({
	name: "core.permission.list",
	title: "List permissions",
	description: "Get the full list of permissions in the cluster.",
	grantByDefault: true,
});

definePermission({
	name: "core.role.list",
	title: "List roles",
	description: "Get the full list of roles and their permissions in the cluster.",
	grantByDefault: true,
});
definePermission({
	name: "core.role.create",
	title: "Create role",
	description: "Create new roles with permissions.",
});
definePermission({
	name: "core.role.update",
	title: "Update role",
	description: "Edit existing roles including permissions they grant.",
});
definePermission({
	name: "core.role.delete",
	title: "Delete role",
	description: "Permanently delete roles.",
});

definePermission({
	name: "core.user.get",
	title: "Get user",
	description: "Get the details of a user in the cluster.",
});
definePermission({
	name: "core.user.list",
	title: "List users",
	description: "Get the full list of users in the cluster.",
});
definePermission({
	name: "core.user.subscribe",
	title: "Subscribe to user updates",
	description: "Subscribe to be notified on updates on the details and status of users.",
});
definePermission({
	name: "core.user.create",
	title: "Create users",
	description: "Create user acounts with a given name.",
});
definePermission({
	name: "core.user.update_roles",
	title: "Update user roles",
	description: "Add or remove any role to any user.",
});
definePermission({
	name: "core.user.set_admin",
	title: "Set user admin status",
	description: "Promote or demote any user to Factorio admin.",
});
definePermission({
	name: "core.user.set_banned",
	title: "Set user ban status",
	description: "Ban or unban any user.",
});
definePermission({
	name: "core.user.set_whitelisted",
	title: "Set user whitelist status",
	description: "Add or remove any user to/from the whitelist.",
});
definePermission({
	name: "core.user.delete",
	title: "Delete user",
	description: "Delete users and all data stored for them.",
});
definePermission({
	name: "core.log.follow",
	title: "Follow cluster log",
	description: "Receive new entries in the cluster log.  Required to see instance console.",
});
definePermission({
	name: "core.log.query",
	title: "Query cluster log",
	description: "Query past entries in the cluster log.  Required to see past entries in instance console.",
});

definePermission({
	name: "core.debug.dump_ws",
	title: "Dump WebSocket",
	description: "Dump all WebSocket communicatation from the master.",
});

module.exports = {
	Permission,
	Role,
	User,

	permissions,
	definePermission,
	ensureDefaultAdminRole,
	ensureDefaultPlayerRole,
};
