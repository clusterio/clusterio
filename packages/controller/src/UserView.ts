import { Static, Type } from "@sinclair/typebox";

import {
	IUserView, PermissionError, PlayerStats,
	Role, SubscribableDatastore, User, permissions,
} from "@clusterio/lib";

/** Underlying data class for the user on the controller */
export class UserRecord extends User {
	constructor(
		/** Unix time in seconds the user token must be issued after to be valid.  */
		public tokenValidAfter = 0,
		...args: ConstructorParameters<typeof User>
	) {
		super(...args);
	}

	static jsonSchema = Type.Object({
		...User.jsonSchema.properties,
		token_valid_after: Type.Optional(Type.Number()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		const instanceStats = new Map(
			(json.instance_stats ?? []).map(([id, stats]) => [id, PlayerStats.fromJSON(stats)])
		);
		return new this(
			json.token_valid_after,
			json.name,
			new Set(json.roles),
			new Set(json.instances),
			json.is_admin,
			json.is_banned,
			json.is_whitelisted,
			json.ban_reason,
			json.updated_at_ms,
			json.is_deleted,
			User._calculatePlayerStats(instanceStats),
			instanceStats,
		);
	}

	toJSON(): Static<typeof UserRecord.jsonSchema> {
		const json: Static<typeof UserRecord.jsonSchema> = super.toJSON();
		json.token_valid_after = this.tokenValidAfter;
		return json;
	}
}

/**
 * Represents a user as viewed from the controller.
 *
 * All methods are safe to use when readonly.
 * Only use mutable when needing to change multiple values.
 */
export default class UserView extends UserRecord implements IUserView {
	constructor(
		private _controllerUsers: SubscribableDatastore<UserRecord>,
		private _controllerRoles: SubscribableDatastore<Role>,
		...args: ConstructorParameters<typeof UserRecord>
	) {
		super(...args);
	}

	static fromUserRecord(
		_controllerUsers: SubscribableDatastore<UserRecord>,
		_controllerRoles: SubscribableDatastore<Role>,
		userRecord: UserRecord,
	): UserView {
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
			userRecord.playerStats,
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
