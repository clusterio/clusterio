import fs from "fs-extra";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";

import User from "./User";
import UserRecord from "./UserRecord";

/**
 * Access layer for users on the controller.
 *
 * In performance critical paths the raw records can be accessed directly.
 * Otherwise this class will wrap data in a view class with a set and save method.
 *
 * @alias module:controller/src/UserManager
 */
export default class UserManager {
	constructor(
		public records: lib.SubscribableDatastore<UserRecord>,
		private _controllerRoles: lib.SubscribableDatastore<lib.Role>,
		private _controllerConfig: lib.ControllerConfig,
	) {
	}

	/**
	 * Prior to 2.0.0-alpha.22 users and roles were stored in a single file.
	 * This migration separates them so they can be loaded by datastore.
	 *
	 * @param usersFilePath The src and dst file path for the users json file
	 * @param rolesFilePath The dst for the roles json file
	 */
	static async attemptMigrateLegacyUsersFile(usersFilePath: string, rolesFilePath: string) {
		try {
			const combinedJson = JSON.parse(await fs.readFile(usersFilePath, { encoding: "utf8" }));
			if (!("roles" in combinedJson)) {
				return; // Files are already split, no action required
			}
			if (!("users" in combinedJson)) {
				throw new Error("Legacy users json does not contain users property");
			}

			// We intentionally write the roles first because if it fails then the old user file will still contain them
			await lib.safeOutputFile(rolesFilePath, JSON.stringify(combinedJson.roles));
			await lib.safeOutputFile(usersFilePath, JSON.stringify(combinedJson.users));
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}
		}
	}

	getByIdMutable(id: UserRecord["id"]) {
		const userRecord = this.records.getMutable(id);
		if (!userRecord) {
			return undefined;
		}

		return User.fromUserRecord(
			this.records,
			this._controllerRoles,
			userRecord,
		);
	}

	getById(id: UserRecord["id"]): Readonly<User> | undefined {
		return this.getByIdMutable(id);
	}

	getByNameMutable(name: UserRecord["name"]) {
		return this.getByIdMutable(name.toLowerCase());
	}

	getByName(name: UserRecord["name"]) {
		return this.getById(name.toLowerCase());
	}

	valuesMutable(): IterableIterator<User> {
		const roles = this._controllerRoles;
		const users = this.records;

		return (function* () {
			for (const record of users.values()) {
				yield User.fromUserRecord(users, roles, record);
			}
		}());
	}

	values(): IterableIterator<Readonly<User>> {
		return this.valuesMutable();
	}

	/**
	 * Creates a new user and add it to the user database.
	 * @param name - Name of the user to create.
	 * @returns The created user.
	 */
	createUser(name: string): User {
		if (this.getByName(name)) {
			throw new Error(`User '${name}' already exists`);
		}

		let roles = new Set<number>();
		let defaultRoleId = this._controllerConfig.get("controller.default_role_id");
		if (defaultRoleId !== null && this._controllerRoles.has(defaultRoleId)) {
			roles.add(defaultRoleId);
		}

		const user = new User(this.records, this._controllerRoles, 0, name, roles);
		this.records.set(user);
		return user;
	}

	/** Get or create a user with a given name. */
	getOrCreateUser(name: string): User {
		return this.getByNameMutable(name) ?? this.createUser(name);
	}

	/**
	 * Deletes an existing user
	 *
	 * @param user - user to delete
	 */
	deleteUser(user: UserRecord) {
		return this.records.delete(user);
	}

	/**
	 * Sign access token for the given user
	 *
	 * @param user - user to sign token for
	 * @returns JWT access token for the user.
	 */
	signUserToken(user: UserRecord): string {
		return jwt.sign(
			{ aud: "user", user: user.id },
			Buffer.from(this._controllerConfig.get("controller.auth_secret"), "base64")
		);
	}

	/** Clear all player stats for specific instance */
	clearStatsOfInstance(instanceId: number) {
		for (const user of this.values()) {
			user.clearInstanceStats(instanceId);
		}
	}
}
