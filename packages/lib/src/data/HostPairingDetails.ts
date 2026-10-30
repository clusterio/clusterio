import { Type, Static } from "@sinclair/typebox";

/**
 * A pending request from a host installer to join the cluster
 *
 * Requests are kept in memory on the controller only while the installer
 * waits for them to be approved or rejected.
 */
export default class HostPairingDetails {
	constructor(
		/** Code shown by the installer, used to identify the request. */
		public code: string,
		/** Name the installer asked for the host to have. */
		public name: string,
		/** Address the request was made from. */
		public remoteAddress: string,
		/** Version of the installer that made the request. */
		public version = "",
		/** Millisecond Unix timestamp the request was made at. */
		public createdAtMs = 0,
		/** Millisecond Unix timestamp this entry was last updated at. */
		public updatedAtMs = 0,
		/** True if this request is no longer pending. */
		public isDeleted = false,
	) { }

	get id() {
		return this.code;
	}

	static jsonSchema = Type.Object({
		"code": Type.String(),
		"name": Type.String(),
		"remoteAddress": Type.String(),
		"version": Type.Optional(Type.String()),
		"createdAtMs": Type.Optional(Type.Number()),
		"updatedAtMs": Type.Optional(Type.Number()),
		"isDeleted": Type.Optional(Type.Boolean()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.code,
			json.name,
			json.remoteAddress,
			json.version,
			json.createdAtMs,
			json.updatedAtMs,
			json.isDeleted,
		);
	}

	toJSON() {
		const json: Static<typeof HostPairingDetails.jsonSchema> = {
			code: this.code,
			name: this.name,
			remoteAddress: this.remoteAddress,
		};
		if (this.version !== "") {
			json.version = this.version;
		}
		if (this.createdAtMs !== 0) {
			json.createdAtMs = this.createdAtMs;
		}
		if (this.updatedAtMs !== 0) {
			json.updatedAtMs = this.updatedAtMs;
		}
		if (this.isDeleted) {
			json.isDeleted = this.isDeleted;
		}
		return json;
	}
}
