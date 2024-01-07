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
		public updatedAt = 0,
	) {
		this.config = config;
		this.status = status;
	}

	static jsonSchema = Type.Object({
		"config": Type.Object({}),
		"status": lib.InstanceStatus,
		"gamePort": Type.Optional(Type.Number()),
		"updatedAt": Type.Optional(Type.Number()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>, config: lib.InstanceConfig) {
		return new this(
			config,
			json.status,
			json.gamePort,
			json.updatedAt,
		);
	}

	toJSON(): Static<typeof InstanceInfo.jsonSchema> {
		return {
			config: this.config.serialize(),
			status: this.status,
			gamePort: this.gamePort,
			updatedAt: this.updatedAt,
		};
	}

	toInstanceDetails() {
		return new lib.InstanceDetails(
			this.config.get("instance.name"),
			this.id,
			this.config.get("instance.assigned_host") ?? undefined,
			this.gamePort,
			this.status,
			this.updatedAt,
		);
	}

	get isDeleted() {
		return this.status === "deleted";
	}

	/** Shorthand for `instance.config.get("instance.id")` */
	get id():number {
		return this.config.get("instance.id");
	}
}
