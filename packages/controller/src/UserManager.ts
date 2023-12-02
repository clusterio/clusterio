import fs from "fs-extra";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";

import ControllerUser from "./ControllerUser";

/**
 * Manages users and roles
 * @alias module:controller/src/UserManager
 */
export default class UserManager {
	roles: Map<number, lib.Role> = new Map();
	users: Map<string, ControllerUser> = new Map();
	dirty = false;

	/**
	 * Set of users currently online in the cluster.
	 */
	onlineUsers = new Set<ControllerUser>();

	constructor(
		private _config: lib.ControllerConfig
	) {
	}

	async load(filePath: string): Promise<void> {
		try {
			let content = JSON.parse(await fs.readFile(filePath, { encoding: "utf8" }));
			for (let serializedRole of content.roles) {
				let role = lib.Role.fromJSON(serializedRole);
				this.roles.set(role.id, role);
			}

			for (let serializedUser of content.users) {
				let user = ControllerUser.fromJSON(serializedUser, this);
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
	createUser(name:string): ControllerUser {
		if (this.users.has(name)) {
			throw new Error(`User '${name}' already exists`);
		}

		let roles = new Set<number>();
		let defaultRoleId = this._config.get("controller.default_role_id");
		if (defaultRoleId !== null && this.roles.has(defaultRoleId)) {
			roles.add(defaultRoleId);
		}

		let user = new ControllerUser(this, 0, name, roles);
		this.users.set(name, user);
		this.dirty = true;
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
}
