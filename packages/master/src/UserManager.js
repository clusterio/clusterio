"use strict";
const fs = require("fs-extra");

const libUsers = require("@clusterio/lib/users");

/**
 * Manages users and roles
 * @alias module:master/src/UserManager
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
				let role = new libUsers.Role(serializedRole);
				loadedRoles.set(role.id, role);
			}

			for (let serializedUser of content.users) {
				let user = new libUsers.User(serializedUser, loadedRoles);
				loadedUsers.set(user.name, user);
			}

		} catch (err) {
			if (err.code !== "ENOENT") {
				throw err;
			}

			// Create default roles if loading failed
			libUsers.ensureDefaultAdminRole(loadedRoles);
			libUsers.ensureDefaultPlayerRole(loadedRoles);
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
		await fs.outputFile(filePath, JSON.stringify(serialized, null, 4));
	}

	/**
	 * Create a new user
	 *
	 * Creates a new user and add it to the user database.
	 *
	 * @param {string} name - Name of the user to create.
	 * @returns {module:lib/users.User} newly created user.
	 */
	createUser(name) {
		if (this.users.has(name)) {
			throw new Error(`User '${name}' already exists`);
		}

		let defaultRoleId = this._config.get("master.default_role_id");
		let user = new libUsers.User({ name, roles: [defaultRoleId] }, this.roles);
		this.users.set(name, user);
		return user;
	}
}

module.exports = UserManager;
