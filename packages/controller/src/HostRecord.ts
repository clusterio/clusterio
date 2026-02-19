import { Type, Static } from "@sinclair/typebox";
import { HostDetails } from "@clusterio/lib";

/** Underlying data class for hosts on the controller */
export default class HostRecord {
	constructor(
		/** Id of this host */
		public id: number,
		/** Name of this host */
		public name: string,
		/** Version this host last connected with */
		public version: string,
		/** Plugins this host last connected with */
		public plugins: Map<string, string>,
		/** True if this host is currently connected to controller */
		public connected: boolean = false,
		/** IP this host last connected from */
		public remoteAddress: string = "",
		/** Value of host.public_address configured for this host */
		public publicAddress: string = "",
		/** Unix timestamp in seconds host token must be issued after to be valid */
		public tokenValidAfter: number = 0,
		/** Millisecond Unix timestamp this entry was last updated at */
		public updatedAtMs: number = 0,
		/** True if this host has been deleted */
		public isDeleted: boolean = false,
	) { }

	static jsonSchema = Type.Object({
		"id": Type.Number(),
		"name": Type.String(),
		"version": Type.String(),
		"plugins": Type.Record(Type.String(), Type.String()),
		"connected": Type.Optional(Type.Boolean()),
		"remote_address": Type.Optional(Type.String()),
		"public_address": Type.Optional(Type.String()),
		"token_valid_after": Type.Optional(Type.Number()),
		"updated_at_ms": Type.Optional(Type.Number()),
		"is_deleted": Type.Optional(Type.Boolean()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.id,
			json.name,
			json.version,
			new Map(Object.entries(json.plugins)),
			json.connected,
			json.remote_address,
			json.public_address,
			json.token_valid_after,
			json.updated_at_ms,
			json.is_deleted,
		);
	}

	toJSON() {
		const json = {
			id: this.id,
			name: this.name,
			version: this.version,
			plugins: Object.fromEntries(this.plugins),
		} as Static<typeof HostRecord.jsonSchema>;

		if (this.connected !== false) {
			json.connected = this.connected;
		}
		if (this.remoteAddress !== "") {
			json.remote_address = this.remoteAddress;
		}
		if (this.publicAddress !== "") {
			json.public_address = this.publicAddress;
		}
		if (this.tokenValidAfter !== 0) {
			json.token_valid_after = this.tokenValidAfter;
		}
		if (this.updatedAtMs !== 0) {
			json.updated_at_ms = this.updatedAtMs;
		}
		if (this.isDeleted !== false) {
			json.is_deleted = this.isDeleted;
		}

		return json;
	}


	static fromHostDetails(details: HostDetails, plugins: Map<string, string>) {
		return new HostRecord(
			details.id,
			details.name,
			details.version,
			plugins,
			details.connected,
			details.remoteAddress,
			details.publicAddress,
			details.tokenValidAfter,
			details.updatedAtMs,
			details.isDeleted,
		);
	}

	toHostDetails() {
		return new HostDetails(
			this.version,
			this.name,
			this.id,
			this.connected,
			this.remoteAddress,
			this.publicAddress,
			this.tokenValidAfter,
			this.updatedAtMs,
			this.isDeleted,
		);
	}
}
