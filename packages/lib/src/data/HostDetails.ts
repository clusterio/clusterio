import { Type, Static } from "@sinclair/typebox";

export default class HostDetails {
	constructor(
		/** Version of the host software. The controller may warn if there is a mismatch. */
		public version: string,
		/** Human-readable display name of the host. */
		public name: string,
		/** Unique numeric identifier for this host. */
		public id: number,
		/** Whether the host is currently connected to the controller. */
		public connected: boolean,
		/** Address from which the host has connected to the controller. */
		public remoteAddress = "",
		/** Public-facing IP address of the host, if available. */
		public publicAddress: string = "",
		/** Unix timestamp (sec) after which issued tokens are considered valid. */
		public tokenValidAfter: number = 0,
		/** Unix timestamp (ms) indicating when this record was last updated. */
		public updatedAtMs = 0,
		/** Flag indicating the host record has been removed on the controller. */
		public isDeleted = false
	) {}

	static jsonSchema = Type.Object({
		"version": Type.String(),
		"name": Type.String(),
		"id": Type.Integer(),
		"connected": Type.Boolean(),
		"remoteAddress": Type.Optional(Type.String()),
		"publicAddress": Type.Optional(Type.String()),
		"tokenValidAfter": Type.Optional(Type.Number()),
		"updatedAtMs": Type.Optional(Type.Number()),
		"isDeleted": Type.Optional(Type.Boolean()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.version,
			json.name,
			json.id,
			json.connected,
			json.remoteAddress,
			json.publicAddress,
			json.tokenValidAfter,
			json.updatedAtMs,
			json.isDeleted
		);
	}

	toJSON() {
		const json = {
			version: this.version,
			name: this.name,
			id: this.id,
			connected: this.connected,
		} as Static<typeof HostDetails.jsonSchema>;

		if (this.remoteAddress !== "") {
			json.remoteAddress = this.remoteAddress;
		}
		if (this.publicAddress !== "") {
			json.publicAddress = this.publicAddress;
		}
		if (this.tokenValidAfter !== 0) {
			json.tokenValidAfter = this.tokenValidAfter;
		}
		if (this.updatedAtMs !== 0) {
			json.updatedAtMs = this.updatedAtMs;
		}
		if (this.isDeleted !== false) {
			json.isDeleted = this.isDeleted;
		}

		return json;
	}
}
