import { Static, Type } from "@sinclair/typebox";
import { StringEnum } from "./composites";
import { TargetVersion, TargetVersionSchema } from "./version";

export const InstanceStatus = StringEnum([
	"unknown",
	"unassigned",
	"stopped",
	"starting",
	"running",
	"stopping",
	"creating_save",
	"exporting_data",
	"deleted",
]);

/**
 * Current status of the instance. One of:
 * - `unknown`: Instance is assigned to a host but this host is currently
 *   not connected to the contreller.
 * - `unassigned`: Instance is not assigned to a a host and exists only on
 *   the controller.
 * - `stopped`: Instance is stopped.
 * - `starting`: Instance is in the process of starting up.
 * - `running`: Instance is running normally.
 * - `stopping`: Instance is in the process of stopping.
 * - `creating_save`: Instance is in the process of creating a save.
 * - `exporting_data`: Instance is in the process of exporting game data.
 * - `deleted`: Instance has been deleted.
 */
export type InstanceStatus = Static<typeof InstanceStatus>;

export default class InstanceDetails {
	constructor(
		public name: string,
		public id: number,
		public assignedHost: number | undefined,
		public gamePort: number | undefined,
		public status: InstanceStatus,
		public factorioVersion: TargetVersion | undefined,
		public startedAtMs = 0,
		/** Millisecond Unix timestamp this entry was last updated at */
		public updatedAtMs = 0,
		public excludeFromStartAll = false
	) {}

	get isDeleted() {
		return this.status === "deleted";
	}

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"id": Type.Integer(),
		"assignedHost": Type.Optional(Type.Integer()),
		"gamePort": Type.Optional(Type.Integer()),
		"status": StringEnum([
			"unknown", "unassigned", "stopped", "starting", "running", "stopping",
			"creating_save", "exporting_data", "deleted",
		]),
		"factorioVersion": Type.Optional(TargetVersionSchema),
		"startedAtMs": Type.Optional(Type.Number()),
		"updatedAtMs": Type.Optional(Type.Number()),
		"excludeFromStartAll": Type.Optional(Type.Boolean()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.name,
			json.id,
			json.assignedHost,
			json.gamePort,
			json.status,
			json.factorioVersion,
			json.startedAtMs,
			json.updatedAtMs,
			json.excludeFromStartAll
		);
	}

	toJSON() {
		const json = {
			name: this.name,
			id: this.id,
			status: this.status,
		} as Static<typeof InstanceDetails.jsonSchema>;

		if (this.assignedHost !== undefined) {
			json.assignedHost = this.assignedHost;
		}
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
		if (this.excludeFromStartAll !== false) {
			json.excludeFromStartAll = this.excludeFromStartAll;
		}

		return json;
	}
}
