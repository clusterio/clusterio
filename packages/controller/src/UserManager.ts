import fs from "fs-extra";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";

import ControllerUser from "./ControllerUser";

/**
 * Manages users and roles
 * @alias module:controller/src/UserManager
 */
export default class UserManager {
	roles: Map<lib.Role["id"], lib.Role> = new Map();
	users: Map<ControllerUser["id"], ControllerUser> = new Map();
	dirty = false;

	/**
	 * Set of users currently online in the cluster.
	 */
	onlineUsers = new Set<ControllerUser>();

	constructor(
		private _config: lib.ControllerConfig
	) {
	}

	getByName(name: string) {
		return this.users.get(name.toLowerCase());
	}

	async load(filePath: string): Promise<void> {
		try {
			let content = JSON.parse(await fs.readFile(filePath, { encoding: "utf8" }));
			for (let serializedRole of content.roles) {
				let role = lib.Role.fromJSON(serializedRole);
				this.roles.set(role.id, role);
			}

			let duplicates = 0;
			for (let serializedUser of content.users) {
				let user = ControllerUser.fromJSON(serializedUser, this);
				const existingUser = this.users.get(user.id);
				if (existingUser) {
					// Required migration to all lowercase ids in alpha 19
					duplicates += 1;
					// We assume the user with the lower online time is the duplicate
					if (user.playerStats.onlineTimeMs <= existingUser.playerStats.onlineTimeMs) {
						existingUser.merge(user);
						continue; // Skip users.set
					}
					user.merge(existingUser);
				}
				this.users.set(user.id, user);
			}

			if (duplicates) {
				const backupPath = `${filePath}.${Date.now()}.bak`;
				lib.logger.warn(
					`A total of ${duplicates} users were merged, a backup was written to: ${backupPath}`
				);
				await lib.safeOutputFile(backupPath, content);
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

	async save(filePath: string): Promise<void> {
		let serializedRoles = [];
		for (let role of this.roles.values()) {
			serializedRoles.push(role.toJSON());
		}

		let serializedUsers = [];
		for (let user of this.users.values()) {
			serializedUsers.push(user.toJSON(true));
		}

		let serialized = {
			users: serializedUsers,
			roles: serializedRoles,
		};
		this.dirty = false;
		await lib.safeOutputFile(filePath, JSON.stringify(serialized, null, "\t"));
	}

	/**
	 * Creates a new user and add it to the user database.
	 * @param name - Name of the user to create.
	 * @returns The created user.
	 */
	createUser(name: string): ControllerUser {
		if (this.getByName(name)) {
			throw new Error(`User '${name}' already exists`);
		}

		let roles = new Set<number>();
		let defaultRoleId = this._config.get("controller.default_role_id");
		if (defaultRoleId !== null && this.roles.has(defaultRoleId)) {
			roles.add(defaultRoleId);
		}

		let user = new ControllerUser(this, 0, name, roles);
		this.users.set(user.id, user);
		this.dirty = true;
		return user;
	}

	/**
	 * Sign access token for the given user
	 *
	 * @param user - user to sign token for
	 * @returns JWT access token for the user.
	 */
	signUserToken(user: ControllerUser): string {
		return jwt.sign(
			{ aud: "user", user: user.id },
			Buffer.from(this._config.get("controller.auth_secret"), "base64")
		);
	}

	notifyJoin(user: ControllerUser, instance_id: number) {
		user.instances.add(instance_id);
		this.onlineUsers.add(user);
	}

	notifyLeave(user: ControllerUser, instance_id: number) {
		user.instances.delete(instance_id);
		if (!user.instances.size) {
			this.onlineUsers.delete(user);
		}
	}

	clearStatsOfInstance(instanceId: number) {
		for (const user of this.users.values()) {
			this.notifyLeave(user, instanceId);
			user.instanceStats.delete(instanceId);
			user.recalculatePlayerStats();
		}
		this.dirty = true;
	}
}
