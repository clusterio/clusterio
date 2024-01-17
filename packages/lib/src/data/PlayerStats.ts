import { Type, Static } from "@sinclair/typebox";

/**
 * Stastics collected about a player.
 */
export default class PlayerStats {
	/**
	 * Count of the number of times this player has been seen joining this server.
	 */
	joinCount = 0;

	/**
	 * Time in ms this player has been seen online on this instance.
	 */
	onlineTimeMs = 0;

	/**
	 * Timestapm the player was first seen joining.
	 */
	firstJoinAt?: Date;

	/**
	 * Timestamp the player was last seen joining.
	 */
	lastJoinAt?: Date;

	/**
	 * Timestamp the player was last seen leaving.
	 */
	lastLeaveAt?: Date;

	/**
	 * Reason the player was last seen leaving with.
	 */
	lastLeaveReason?: string;

	static jsonSchema = Type.Object({
		"join_count": Type.Optional(Type.Integer()),
		"online_time_ms": Type.Optional(Type.Number()),
		"first_join_at": Type.Optional(Type.Number()),
		"last_join_at": Type.Optional(Type.Number()),
		"last_leave_at": Type.Optional(Type.Number()),
		"last_leave_reason": Type.Optional(Type.String()),
	});

	constructor(json: Static<typeof PlayerStats.jsonSchema> = {}) {
		if (json["join_count"]) {
			this.joinCount = json["join_count"];
		}
		if (json["first_join_at"]) {
			this.firstJoinAt = new Date(json["first_join_at"]);
		}
		if (json["online_time_ms"]) {
			this.onlineTimeMs = json["online_time_ms"];
		}
		if (json["last_join_at"]) {
			this.lastJoinAt = new Date(json["last_join_at"]);
			if (!this.firstJoinAt) { // migrate: pre-alpha 14 did not have this field.
				this.firstJoinAt = this.lastJoinAt;
			}
		}
		if (json["last_leave_at"]) {
			this.lastLeaveAt = new Date(json["last_leave_at"]);
			this.lastLeaveReason = json["last_leave_reason"] || "quit";
		}
	}

	static fromJSON(json: Static<typeof PlayerStats.jsonSchema>) {
		return new this(json);
	}

	toJSON() {
		let json: Static<typeof PlayerStats.jsonSchema> = {};
		if (this.joinCount) {
			json["join_count"] = this.joinCount;
		}
		if (this.onlineTimeMs) {
			json["online_time_ms"] = this.onlineTimeMs;
		}
		if (this.firstJoinAt) {
			json["first_join_at"] = this.firstJoinAt.getTime();
		}
		if (this.lastJoinAt) {
			json["last_join_at"] = this.lastJoinAt.getTime();
		}
		if (this.lastLeaveAt) {
			json["last_leave_at"] = this.lastLeaveAt.getTime();
			json["last_leave_reason"] = this.lastLeaveReason;
		}
		return json;
	}
}
