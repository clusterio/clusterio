import { UserDetails } from "@clusterio/lib";
import { Type, Static } from "@sinclair/typebox";

/** Underlying data class for users on the controller */
export default class UserRecord extends UserDetails {
	constructor(
		/** Unix time in seconds the user token must be issued after to be valid.  */
		public tokenValidAfter = 0,
		...args: ConstructorParameters<typeof UserDetails>
	) {
		super(...args);
	}

	static jsonSchema = Type.Object({
		token_valid_after: Type.Optional(Type.Number()),
		...UserDetails.jsonSchema.properties,
	});

	// _a and _b are a ts workaround for allowing User to have extra arguments
	static fromJSON(json: Static<typeof this.jsonSchema>, _a?: any, _b?: any) {
		return this.fromUserDetails(
			UserDetails.fromJSON(json),
			json.token_valid_after,
		);
	}

	toJSON() {
		const json = super.toJSON() as Static<typeof UserRecord.jsonSchema>;

		if (this.tokenValidAfter > 0) {
			json.token_valid_after = this.tokenValidAfter;
		}

		return json;
	}

	static fromUserDetails(
		userDetails: UserDetails,
		tokenValidAfter = 0,
	) {
		return new this(
			tokenValidAfter,
			userDetails.name,
			userDetails.roleIds,
			userDetails.instances,
			userDetails.isAdmin,
			userDetails.isBanned,
			userDetails.isWhitelisted,
			userDetails.banReason,
			userDetails.updatedAtMs,
			userDetails.isDeleted,
			userDetails.instanceStats,
		);
	}

	toUserDetails() {
		return new UserDetails(
			this.name,
			this.roleIds,
			this.instances,
			this.isAdmin,
			this.isBanned,
			this.isWhitelisted,
			this.banReason,
			this.updatedAtMs,
			this.isDeleted,
			this.instanceStats,
		);
	}

	/**
	 * Merge another user into this one, must have matching ids, user is not deleted
	 * @param otherUser - User who's details are merged from
	*/
	merge(otherUser: UserDetails) {
		if (this.id !== otherUser.id) {
			throw new Error("Cannot merge users with different ids");
		}

		// Merge properties
		this.roleIds = new Set([...this.roleIds, ...otherUser.roleIds]);
		this.instances = new Set([...this.instances, ...otherUser.instances]);
		this.isAdmin = this.isAdmin && otherUser.isAdmin; // More secure to use && rather ||
		this.isBanned = this.isBanned || otherUser.isBanned;
		this.isWhitelisted = this.isWhitelisted || otherUser.isWhitelisted;
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

		// Player stats must be recalculated after modifying instance stats
		this.recalculatePlayerStats();
	}
}
