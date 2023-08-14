import fs from "fs-extra";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";

/**
 * Manages users and roles
 * @alias module:controller/src/UserManager
 */
export default class UserManager {
	roles: Map<number, lib.Role> = new Map();
	users: Map<string, lib.User> = new Map();

	constructor(
		private _config: lib.ControllerConfig
	) {
	}

	async load(filePath: string): Promise<void> {
		try {
			let content = JSON.parse(await fs.readFile(filePath, { encoding: 'utf8' }));
			for (let serializedRole of content.roles) {
				let role = new lib.Role(serializedRole);
				this.roles.set(role.id, role);
			}

			for (let serializedUser of content.users) {
				let user = new lib.User(serializedUser, this.roles);
				this.users.set(user.name, user);
			}

		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}

			// Create default roles if loading failed
			lib.ensureDefaultAdminRole(this.roles);
			lib.ensureDefaultPlayerRole(this.roles);
		}
	}

	async save(filePath:string): Promise<void> {
		if (this.roles.size === 0 || this.users.size === 0) {
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
	 * Creates a new user and add it to the user database.
	 * @param name - Name of the user to create.
	 */
	createUser(name:string): lib.User {
		if (this.users.has(name)) {
			throw new Error(`User '${name}' already exists`);
		}

		let roles = [];
		let defaultRoleId = this._config.get("controller.default_role_id");
		if (defaultRoleId !== null) {
			roles.push(defaultRoleId)
		}

		let user = new lib.User({ name, roles }, this.roles);
		this.users.set(name, user);
		return user;
	}

	/**
	 * Sign access token for the given user name
	 *
	 * @param name - user name to sign token for
	 * @returns JWT access token for the user.
	 */
	signUserToken(name: string): string {
		return jwt.sign(
			{ aud: "user", user: name },
			Buffer.from(this._config.get("controller.auth_secret"), "base64")
		);
	}
}
