import fs from "fs-extra";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";

import ControllerUser from "./ControllerUser";

/**
 * Manages users and roles
 * @alias module:controller/src/UserManager
 */
export default class UserManager {
	users: Map<ControllerUser["id"], ControllerUser> = new Map();
	dirty = false;

	/**
	 * Set of users currently online in the cluster.
	 */
	onlineUsers = new Set<ControllerUser>();

	constructor(
		private _config: lib.ControllerConfig,
		private _roles: lib.SubscribableDatastore<lib.Role>,
	) {
	}

	getByName(name: string) {
		return this.users.get(name.toLowerCase());
	}

	async load(filePath: string): Promise<void> {
		try {
			let content = JSON.parse(await fs.readFile(filePath, { encoding: "utf8" }));
			if ("roles" in content) { // Split file format after 2.0.0-alpha.22
				this._roles.setMany(content.roles.map((serializedRole: any) => lib.Role.fromJSON(serializedRole)));
				await this._roles.save(); // Force a save to prevent data loss
				content = content.users;
			}

			let duplicates = 0;
			for (const serializedUser of content) {
				const user = ControllerUser.fromJSON(serializedUser, this._roles);
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
				await lib.safeOutputFile(backupPath, JSON.stringify(content, null, "\t"));
			}

		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}
		}
	}

	async save(filePath: string): Promise<void> {
		this.dirty = false;
		await lib.safeOutputFile(filePath,
			JSON.stringify([...this.users.values()].map(user => user.toJSON(true)), null, "\t")
		);
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
		if (defaultRoleId !== null && this._roles.has(defaultRoleId)) {
			roles.add(defaultRoleId);
		}

		let user = new ControllerUser(this._roles, 0, name, roles);
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
