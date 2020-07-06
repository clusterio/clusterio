/**
 * User and permissions library
 *
 * Defines data types for users, roles and permissions.
 *
 * @author Hornwitser
 * @module
 */
"use strict";
const jwt = require("jsonwebtoken");

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
	constructor({ id, name, description, permissions }) {
		this.id = id;
		this.name = name;
		this.description = description;
		this.permissions = new Set(permissions);
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
		admin = new Role({ id: 0, name: "Admin", description: "Cluster wide administrator." });
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
	constructor({ name, roles, tokenValidAfter }, loadedRoles) {
		/**
		 * Factorio user name.
		 * @type {string}
		 */
		this.name = name;

		/**
		 * Instances this user is online on.
		 * @type {Set<number>}
		 */
		this.instances = new Set();

		/**
		 * Unix time in seconds the user token must be issued after to be valid.
		 * @type {number}
		 */
		this.tokenValidAfter = tokenValidAfter || 0;

		/**
		 * Roles this user has
		 * @type {Set<module:lib/permissions.Role>}
		 */
		this.roles = new Set();
		if (roles) {
			for (let roleId of roles) {
				let role = loadedRoles.get(roleId);
				if (role) {
					this.roles.add(role);
				}
			}
		}
	}

	serialize() {
		let serialized = {
			name: this.name,
			roles: [...this.roles].map(role => role.id),
		};

		if (this.tokenValidAfter) {
			serialized.tokenValidAfter = this.tokenValidAfter;
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
		return jwt.sign({ aud: "user", user: this.name }, secret);
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
	 * @throws {Error} if the user does noh have the given permission.
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

		throw new Error("Permission denied");
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
}
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
	name: "core.slave.list",
	title: "List slaves",
	description: "Get the full list of slaves in the cluster.",
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
	name: "core.instance.list",
	title: "List instances",
	description: "Get the full list of instances in the cluster.",
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
	name: "core.instance.follow_log",
	title: "Follow instance log",
	description: "Listen for the stdout log of instances.",
});
definePermission({
	name: "core.instance.create_save",
	title: "Create new instance save",
	description: "Create new savegames on instances.",
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
	name: "core.user.list",
	title: "List users",
	description: "Get the full list of users in the cluster.",
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
	name: "core.user.delete",
	title: "Delete user",
	description: "Delete users and all data stored for them.",
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
