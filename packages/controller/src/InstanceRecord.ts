import * as lib from "@clusterio/lib";
import { Static, Type } from "@sinclair/typebox";

/** Underlying data class for instances on the controller */
export default class InstanceRecord {
	constructor(
		public config: lib.InstanceConfig,
		public status: lib.InstanceStatus,
		public gamePort?: number,
		public factorioVersion?: lib.TargetVersion,
		public startedAtMs = 0,
		public updatedAtMs = 0,
	) {
		this.config = config;
		this.status = status;
	}

	get id(): number {
		return this.config.get("instance.id");
	}

	get isDeleted() {
		return this.status === "deleted";
	}

	set isDeleted(value: boolean) {
		if (value === false) {
			throw new Error("Setting isDeleted to false is not supported, use status instead.");
		}
		this.status = "deleted";
	}

	static jsonSchema = Type.Object({
		"config": lib.InstanceConfig.jsonSchema,
		"status": lib.InstanceStatus,
		"gamePort": Type.Optional(Type.Number()),
		"startedAtMs": Type.Optional(Type.Number()),
		"updatedAtMs": Type.Optional(Type.Number()),
		"factorioVersion": Type.Optional(lib.TargetVersionSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			lib.InstanceConfig.fromJSON(json.config, "controller"),
			json.status,
			json.gamePort,
			json.factorioVersion,
			json.startedAtMs,
			json.updatedAtMs,
		);
	}

	toJSON(): Static<typeof InstanceRecord.jsonSchema> {
		const json: any = {
			config: this.config.toJSON(),
			status: this.status,
		};

		if (this.gamePort !== undefined) {
			json.gamePort = this.gamePort;
		}
		if (this.factorioVersion !== undefined) {
			json.factorioVersion = this.factorioVersion;
		}
		if (this.startedAtMs !== 0) {
			json.startedAtMs = this.startedAtMs;
		}
		if (this.updatedAtMs !== 0) {
			json.updatedAtMs = this.updatedAtMs;
		}

		return json;
	}

	toInstanceDetails() {
		return new lib.InstanceDetails(
			this.config.get("instance.name"),
			this.id,
			this.config.get("instance.assigned_host") ?? undefined,
			this.gamePort,
			this.status,
			this.factorioVersion,
			this.startedAtMs,
			this.updatedAtMs,
			this.config.get("instance.exclude_from_start_all"),
		);
	}

	static fromInstanceDetails(details: lib.InstanceDetails, config: lib.InstanceConfig) {
		return new InstanceRecord(
			config,
			details.status,
			details.gamePort,
			details.factorioVersion,
			details.startedAtMs,
			details.updatedAtMs,
		);
	}
}
