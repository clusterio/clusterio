
import {
	IUser, Role, SubscribableDatastore,
	PermissionError, permissions,
} from "@clusterio/lib";

import UserRecord from "./UserRecord";
import { Static } from "@sinclair/typebox";

/**
 * Represents a user as viewed from the controller.
 *
 * All methods are safe to use when readonly.
 * Only use mutable when needing to change multiple values.
 */
export default class User extends UserRecord implements IUser {
	constructor(
		private _controllerUsers: SubscribableDatastore<UserRecord>,
		private _controllerRoles: SubscribableDatastore<Role>,
		...args: ConstructorParameters<typeof UserRecord>
	) {
		super(...args);
	}

	static fromJSON(
		json: Static<typeof this.jsonSchema>,
		_controllerUsers: SubscribableDatastore<UserRecord>,
		_controllerRoles: SubscribableDatastore<Role>,
	) {
		return this.fromUserRecord(
			UserRecord.fromJSON(json),
			_controllerUsers,
			_controllerRoles,
		);
	}

	static fromUserRecord(
		userRecord: UserRecord,
		_controllerUsers: SubscribableDatastore<UserRecord>,
		_controllerRoles: SubscribableDatastore<Role>,
	): User {
		return new this(
			_controllerUsers,
			_controllerRoles,
			userRecord.tokenValidAfter,
			userRecord.name,
			userRecord.roleIds,
			userRecord.instances,
			userRecord.isAdmin,
			userRecord.isBanned,
			userRecord.isWhitelisted,
			userRecord.banReason,
			userRecord.updatedAtMs,
			userRecord.isDeleted,
			userRecord.instanceStats,
		);
	}

	/** Roles this user has */
	get roles(): ReadonlySet<Readonly<Role>> {
		return new Set([...this.roleIds].map(
			id => this._controllerRoles.get(id)
		).filter(
			(r): r is Role => Boolean(r)
		));
	}

	/** Save the underlying user record */
	saveRecord() {
		this._controllerUsers.set(this);
	}

	/** Set a property on the underlying record, then save it. */
	set<K extends keyof this>(key: K, value: this[K]) {
		this[key] = value;
		this.saveRecord();
	}

	/**
	 * Invalidate current tokens for the user
	 *
	 * Sets the tokenValidAfter property to the current time, which causes
	 * all currently issued tokens for the user to become invalid.
	 */
	invalidateToken() {
		this.tokenValidAfter = Math.floor(Date.now() / 1000);
		this.saveRecord();
	}

	/** Add a role to this user */
	addRole(roleId: number) {
		const role = this._controllerRoles.get(roleId);
		if (!role) {
			throw new Error(`role ${roleId} does not exist`);
		}
		this.roleIds.add(roleId);
		this.saveRecord();
	}

	/** Remove a role from user */
	removeRole(roleId: number) {
		if (!this.roleIds.delete(roleId)) {
			return false;
		}
		this.saveRecord();
		return true;
	}

	/** Set a user as being online on a specific instance */
	notifyJoin(instanceId: number) {
		this.instances.add(instanceId);
		this.saveRecord();
	}

	/** Set a user as being offline on a specific instance */
	notifyLeave(instanceId: number) {
		this.instances.delete(instanceId);
		this.saveRecord();
	}

	/** Clear the stats of a player on a specific instance */
	clearInstanceStats(instanceId: number) {
		this.instances.delete(instanceId);
		this.instanceStats.delete(instanceId);
		this.recalculatePlayerStats();
		this.saveRecord();
	}

	checkPermission(permission: string) {
		if (!permissions.has(permission)) {
			throw new Error(`permission ${permission} does not exist`);
		}

		for (const roleId of this.roleIds) {
			const role = this._controllerRoles.get(roleId);
			if (!role) {
				continue;
			}
			if (role.permissions.has("core.admin") || role.permissions.has(permission)) {
				return;
			}
		}

		throw new PermissionError("Permission denied");
	}
}
