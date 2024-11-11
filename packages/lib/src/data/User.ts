import { Static, Type } from "@sinclair/typebox";

import PlayerStats from "./PlayerStats";

/**
 * Represeents a user in the cluster
 *
 * Holds data about a Factorio user in the cluster.
 */
export default class User {
	constructor(
		/** Factorio user name.  */
		public name: string,
		/** Roles this user has */
		public roleIds = new Set<number>(),
		/** Instances this user is online on.  */
		public instances = new Set<number>(),
		/** True if the user is promoted to admin on the Factorio instances.  */
		public isAdmin = false,
		/** True if the user is banned from Factorio instances.  */
		public isBanned = false,
		/** True if the user is whitelisted on the Factorio instances.  */
		public isWhitelisted = false,
		/** Reason for being banned.  Ignored if isBanned is false.  */
		public banReason = "",
		/** Millisecond Unix timestamp this entry was last updated at */
		public updatedAtMs = 0,
		/** True if this user object has been removed from the cluster.  */
		public isDeleted = false,
		/** Combined statistics for the player this user account is tied to.  */
		public playerStats = new PlayerStats(),
		/** Per instance statistics for the player this user account is tied to.  */
		public instanceStats = new Map<number, PlayerStats>(),
	) {
	}

	static jsonSchema = Type.Object({
		name: Type.String(),
		roles: Type.Optional(Type.Array(Type.Integer())),
		instances: Type.Optional(Type.Array(Type.Integer())),
		is_admin: Type.Optional(Type.Boolean()),
		is_banned: Type.Optional(Type.Boolean()),
		is_whitelisted: Type.Optional(Type.Boolean()),
		ban_reason: Type.Optional(Type.String()),
		updated_at_ms: Type.Optional(Type.Number()),
		is_deleted: Type.Optional(Type.Boolean()),
		instance_stats: Type.Optional(
			Type.Array(
				Type.Tuple([Type.Integer(), PlayerStats.jsonSchema]),
			)
		),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>, _hack?: any) {
		const roleIds = new Set<number>(json.roles ?? []);
		const instanceStats = new Map(
			(json.instance_stats ?? []).map(
				([id, stats]) => [id, PlayerStats.fromJSON(stats)]
			)
		);
		const playerStats = User._calculatePlayerStats(instanceStats);
		return new this(
			json.name,
			roleIds,
			new Set(json.instances),
			json.is_admin,
			json.is_banned,
			json.is_whitelisted,
			json.ban_reason,
			json.updated_at_ms,
			json.is_deleted,
			playerStats,
			instanceStats,
		);
	}

	toJSON() {
		let json: Static<typeof User.jsonSchema> = {
			name: this.name,
		};

		if (this.roleIds.size) {
			json.roles = [...this.roleIds];
		}

		if (this.instances.size) {
			json.instances = [...this.instances];
		}

		if (this.isAdmin) {
			json.is_admin = true;
		}

		if (this.isWhitelisted) {
			json.is_whitelisted = true;
		}

		if (this.isBanned) {
			json.is_banned = true;
		}

		if (this.banReason) {
			json.ban_reason = this.banReason;
		}

		if (this.updatedAtMs) {
			json.updated_at_ms = this.updatedAtMs;
		}

		if (this.isDeleted) {
			json.is_deleted = this.isDeleted;
		}

		if (this.instanceStats.size) {
			json.instance_stats = [...this.instanceStats].map(([id, stats]) => [id, stats.toJSON()]);
		}

		return json;
	}

	recalculatePlayerStats() {
		this.playerStats = User._calculatePlayerStats(this.instanceStats);
	}

	static _calculatePlayerStats(instanceStatsMap: Map<number, PlayerStats>) {
		let playerStats = new PlayerStats();
		for (let instanceStats of instanceStatsMap.values()) {
			if (
				instanceStats.firstJoinAt
				&& (!playerStats.firstJoinAt || instanceStats.firstJoinAt < playerStats.firstJoinAt)
			) {
				playerStats.firstJoinAt = instanceStats.firstJoinAt;
			}
			if (
				instanceStats.lastJoinAt
				&& (!playerStats.lastJoinAt || instanceStats.lastJoinAt > playerStats.lastJoinAt)
			) {
				playerStats.lastJoinAt = instanceStats.lastJoinAt;
			}
			if (
				instanceStats.lastLeaveAt
				&& (!playerStats.lastLeaveAt || instanceStats.lastLeaveAt > playerStats.lastLeaveAt)
			) {
				playerStats.lastLeaveAt = instanceStats.lastLeaveAt;
				playerStats.lastLeaveReason = instanceStats.lastLeaveReason;
			}
			playerStats.joinCount += instanceStats.joinCount;
			playerStats.onlineTimeMs += instanceStats.onlineTimeMs;
		}
		return playerStats;
	}

	/**
	 * Merge another user into this one, must have matching ids, user is not deleted
	 * @param otherUser - User who's details are merged from
	*/
	merge(otherUser: User) {
		if (this.id !== otherUser.id) {
			throw new Error("Cannot merge users with different ids");
		}

		// Merge properties
		this.roleIds = new Set([...this.roleIds, ...otherUser.roleIds]);
		this.instances = new Set([...this.instances, ...otherUser.instances]);
		this.isAdmin = this.isAdmin && otherUser.isAdmin; // More secure to use && rather ||
		this.isBanned = this.isBanned || otherUser.isBanned;
		this.isBanned = this.isWhitelisted || otherUser.isWhitelisted;
		this.banReason = this.updatedAtMs > otherUser.updatedAtMs ? this.banReason : otherUser.banReason;
		this.updatedAtMs = Date.now();

		// Merge instance stats
		const thisInstanceStats = this.instanceStats;
		for (const [instanceId, instanceStats] of otherUser.instanceStats.entries()) {
			if (thisInstanceStats.has(instanceId)) {
				thisInstanceStats.get(instanceId)!.merge(instanceStats);
			} else {
				thisInstanceStats.set(instanceId, instanceStats);
			}
		}
		this.recalculatePlayerStats();
	}

	/** Name of the user, used by event subscriptions and to ensure case insensitivity */
	get id() {
		return this.name.toLowerCase();
	}
}

export interface IControllerUser extends User {
	/**
	 * Check if a given permission is granted
	 *
	 * Checks the roles the user is member of for one that grants the given
	 * permission.  If the permission is not granted for the user a
	 * "Permission denied" error is thrown.
	 *
	 * @param permission - The permission to check for.
	 * @throws {Error} If the given permission does not exist.
	 * @throws {libErrors.PermissionError} if the user does noh have the given permission.
	 */
	checkPermission(permission: string): void
}
