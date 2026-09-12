import { Type, type Static } from "@sinclair/typebox";

export default class HostDetails {
	/** Version of the host software. The controller may warn if there is a mismatch. */
	version: string;
	/** Human-readable display name of the host. */
	name: string;
	/** Unique numeric identifier for this host. */
	id: number;
	/** Whether the host is currently connected to the controller. */
	connected: boolean;
	/** Address from which the host has connected to the controller. */
	remoteAddress: string;
	/** Public-facing IP address of the host, if available. */
	publicAddress: string;
	/** Unix timestamp (sec) after which issued tokens are considered valid. */
	tokenValidAfter: number;
	/** Unix timestamp (ms) indicating when this record was last updated. */
	updatedAtMs: number;
	/** Flag indicating the host record has been removed on the controller. */
	isDeleted: boolean;

	constructor(
		/** {@inheritDoc version} */
		version: string,
		/** {@inheritDoc name} */
		name: string,
		/** {@inheritDoc id} */
		id: number,
		/** {@inheritDoc connected} */
		connected: boolean,
		/** {@inheritDoc remoteAddress} */
		remoteAddress = "",
		/** {@inheritDoc publicAddress} */
		publicAddress: string = "",
		/** {@inheritDoc tokenValidAfter} */
		tokenValidAfter: number = 0,
		/** {@inheritDoc updatedAtMs} */
		updatedAtMs = 0,
		/** {@inheritDoc isDeleted} */
		isDeleted = false,
	) {
		this.version = version;
		this.name = name;
		this.id = id;
		this.connected = connected;
		this.remoteAddress = remoteAddress;
		this.publicAddress = publicAddress;
		this.tokenValidAfter = tokenValidAfter;
		this.updatedAtMs = updatedAtMs;
		this.isDeleted = isDeleted;
	}

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
