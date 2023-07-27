"use strict";
const fs = require("fs-extra");

const lib = require("@clusterio/lib");

/**
 * Manages users and roles
 * @alias module:controller/src/UserManager
 */
class UserManager {
	constructor(config) {
		this._config = config;
		this.roles = null;
		this.users = null;
	}

	async load(filePath) {
		let loadedRoles = new Map();
		let loadedUsers = new Map();
		try {
			let content = JSON.parse(await fs.readFile(filePath));
			for (let serializedRole of content.roles) {
				let role = new lib.Role(serializedRole);
				loadedRoles.set(role.id, role);
			}

			for (let serializedUser of content.users) {
				let user = new lib.User(serializedUser, loadedRoles);
				loadedUsers.set(user.name, user);
			}

		} catch (err) {
			if (err.code !== "ENOENT") {
				throw err;
			}

			// Create default roles if loading failed
			lib.ensureDefaultAdminRole(loadedRoles);
			lib.ensureDefaultPlayerRole(loadedRoles);
		}

		this.roles = loadedRoles;
		this.users = loadedUsers;
	}

	async save(filePath) {
		if (!this.roles || !this.users) {
			return;
		}

		let serializedRoles = [];
		for (let role of this.roles.values()) {
			serializedRoles.push(role.serialize());
		}

		let serializedUsers = [];
		for (let user of this.users.values()) {
			serializedUsers.push(user.serialize());
		}

		let serialized = {
			users: serializedUsers,
			roles: serializedRoles,
		};
		await lib.safeOutputFile(filePath, JSON.stringify(serialized, null, 4));
	}

	/**
	 * Create a new user
	 *
	 * Creates a new user and add it to the user database.
	 *
	 * @param {string} name - Name of the user to create.
	 * @returns {module:lib.User} newly created user.
	 */
	createUser(name) {
		if (this.users.has(name)) {
			throw new Error(`User '${name}' already exists`);
		}

		let defaultRoleId = this._config.get("controller.default_role_id");
		let user = new lib.User({ name, roles: [defaultRoleId] }, this.roles);
		this.users.set(name, user);
		return user;
	}
}

module.exports = UserManager;
