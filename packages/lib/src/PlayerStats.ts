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

	static jsonSchema = {
		type: "object",
		properties: {
			"join_count": { type: "integer" },
			"online_time_ms": { type: "number" },
			"last_join_at": { type: "number" },
			"last_leave_at": { type: "number" },
			"last_leave_reason": { type: "string" },
		},
	};

	constructor(json = {}) {
		if (json["join_count"]) {
			this.joinCount = json["join_count"];
		}
		if (json["online_time_ms"]) {
			this.onlineTimeMs = json["online_time_ms"];
		}
		if (json["last_join_at"]) {
			this.lastJoinAt = new Date(json["last_join_at"]);
		}
		if (json["last_leave_at"]) {
			this.lastLeaveAt = new Date(json["last_leave_at"]);
			this.lastLeaveReason = json["last_leave_reason"] || "quit";
		}
	}

	static fromJSON(json: any) {
		return new this(json);
	}

	toJSON() {
		let json = {};
		if (this.joinCount) {
			json["join_count"] = this.joinCount;
		}
		if (this.onlineTimeMs) {
			json["online_time_ms"] = this.onlineTimeMs;
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
