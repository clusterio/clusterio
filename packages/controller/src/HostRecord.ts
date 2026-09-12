import { Type, type Static } from "@sinclair/typebox";
import { HostDetails } from "@clusterio/lib";

/** Underlying data class for hosts on the controller */
export default class HostRecord {
	/** Id of this host */
	id: number;
	/** Name of this host */
	name: string;
	/** Version this host last connected with */
	version: string;
	/** Plugins this host last connected with */
	plugins: Map<string, string>;
	/** True if this host is currently connected to controller */
	connected: boolean;
	/** IP this host last connected from */
	remoteAddress: string;
	/** Value of host.public_address configured for this host */
	publicAddress: string;
	/** Unix timestamp in seconds host token must be issued after to be valid */
	tokenValidAfter: number;
	/** Millisecond Unix timestamp this entry was last updated at */
	updatedAtMs: number;
	/** True if this host has been deleted */
	isDeleted: boolean;

	constructor(
		/** {@inheritDoc id} */
		id: number,
		/** {@inheritDoc name} */
		name: string,
		/** {@inheritDoc version} */
		version: string,
		/** {@inheritDoc plugins} */
		plugins: Map<string, string>,
		/** {@inheritDoc connected} */
		connected: boolean = false,
		/** {@inheritDoc remoteAddress} */
		remoteAddress: string = "",
		/** {@inheritDoc publicAddress} */
		publicAddress: string = "",
		/** {@inheritDoc tokenValidAfter} */
		tokenValidAfter: number = 0,
		/** {@inheritDoc updatedAtMs} */
		updatedAtMs: number = 0,
		/** {@inheritDoc isDeleted} */
		isDeleted: boolean = false,
	) {
		this.id = id;
		this.name = name;
		this.version = version;
		this.plugins = plugins;
		this.connected = connected;
		this.remoteAddress = remoteAddress;
		this.publicAddress = publicAddress;
		this.tokenValidAfter = tokenValidAfter;
		this.updatedAtMs = updatedAtMs;
		this.isDeleted = isDeleted;
	}

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
