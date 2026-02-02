import * as lib from "@clusterio/lib";
import { Static, Type } from "@sinclair/typebox";


/**
 * Runtime status of an instance on the controller
 * @alias module:controller/src/InstanceInfo
 */
export default class InstanceInfo {
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

	static jsonSchema = Type.Object({
		"config": lib.InstanceConfig.jsonSchema,
		"status": lib.InstanceStatus,
		"gamePort": Type.Optional(Type.Number()),
		"startedAtMs": Type.Optional(Type.Number()),
		"updatedAtMs": Type.Optional(Type.Number()),
		"factorioVersion": Type.Optional(lib.TargetVersionSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>, location: lib.ConfigLocation) {
		return new this(
			lib.InstanceConfig.fromJSON(json.config, location),
			json.status,
			json.gamePort,
			json.factorioVersion,
			json.startedAtMs,
			json.updatedAtMs,
		);
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

	get isDeleted() {
		return this.status === "deleted";
	}

	set isDeleted(value: boolean) {
		if (value === false) {
			throw new Error("Setting isDeleted to false is not supported, use status instead.");
		}
		this.status = "deleted";
	}

	/** Shorthand for `instance.config.get("instance.id")` */
	get id():number {
		return this.config.get("instance.id");
	}
}
