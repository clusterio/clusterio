import { Type, Static } from "@sinclair/typebox";
import PlayerStats from "./PlayerStats";
import { JsonString, StringEnum, jsonArray, plainJson } from "./composites";
import { InstanceConfig } from "../config";
import type { IControllerUser } from "./User";
import type { MessageRequest } from "./messages_core";
import { CollectorResultSerialized } from "../prometheus";


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

export class InstanceDetails {
	constructor(
		public name: string,
		public id: number,
		public assignedHost: number | undefined,
		public gamePort: number | undefined,
		public status: InstanceStatus,
		/** Millisecond Unix timestamp this entry was last updated at */
		public updatedAt = 0,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"id": Type.Integer(),
		"assignedHost": Type.Optional(Type.Integer()),
		"gamePort": Type.Optional(Type.Integer()),
		"status": StringEnum([
			"unknown", "unassigned", "stopped", "starting", "running", "stopping",
			"creating_save", "exporting_data", "deleted",
		]),
		"updatedAt": Type.Optional(Type.Number()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.name,
			json.id,
			json.assignedHost,
			json.gamePort,
			json.status,
			json.updatedAt,
		);
	}

	get isDeleted() {
		return this.status === "deleted";
	}
}

export class InstanceDetailsGetRequest {
	declare ["constructor"]: typeof InstanceDetailsGetRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.get" as const;

	constructor(
		public instanceId: number,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId);
	}

	static Response = InstanceDetails;
}

export class InstanceDetailsListRequest {
	declare ["constructor"]: typeof InstanceDetailsListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.list" as const;
	static Response = jsonArray(InstanceDetails);
};

export class InstanceDetailsUpdatesEvent {
	declare ["constructor"]: typeof InstanceDetailsUpdatesEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.instance.subscribe" as const;

	constructor(
		public updates: InstanceDetails[],
	) { }

	static jsonSchema = Type.Object({
		"updates": Type.Array(InstanceDetails.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates.map(update => InstanceDetails.fromJSON(update)));
	}
};

export class InstanceCreateRequest {
	declare ["constructor"]: typeof InstanceCreateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.create" as const;

	constructor(
		public config: Static<typeof InstanceConfig.jsonSchema>,
	) { }

	static jsonSchema = Type.Object({
		"config": InstanceConfig.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.config);
	}
}

export class InstanceConfigGetRequest {
	declare ["constructor"]: typeof InstanceConfigGetRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.get_config" as const;
	static Response = plainJson(InstanceConfig.jsonSchema);

	constructor(
		public instanceId: number,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId);
	}
}

export class InstanceConfigSetFieldRequest {
	declare ["constructor"]: typeof InstanceConfigSetFieldRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.update_config" as const;

	constructor(
		public instanceId: number,
		public field: string,
		public value: string,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"field": Type.String(),
		"value": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.field, json.value);
	}
}

export class InstanceConfigSetPropRequest {
	declare ["constructor"]: typeof InstanceConfigSetPropRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.update_config" as const;

	constructor(
		public instanceId: number,
		public field: string,
		public prop: string,
		public value?: unknown,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"field": Type.String(),
		"prop": Type.String(),
		"value": Type.Unknown(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.field, json.prop, json.value);
	}
}

export class InstanceAssignRequest {
	declare ["constructor"]: typeof InstanceAssignRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.assign" as const;

	constructor(
		public instanceId: number,
		public hostId?: number,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Number(),
		"hostId": Type.Optional(Type.Number()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.hostId);
	}
}

export class InstanceMetricsRequest {
	declare ["constructor"]: typeof InstanceMetricsRequest;
	static type = "request" as const;
	static src = "host" as const;
	static dst = "instance" as const;

	static Response = class Response { // TODO: Use JSON class pattern in Prometheus
		constructor(
			public results: CollectorResultSerialized[],
		) { }

		static jsonSchema = Type.Object({
			"results": Type.Array(CollectorResultSerialized),
		});

		static fromJSON(json: Static<typeof this.jsonSchema>) {
			return new this(json.results);
		}
	};
}

export class InstanceStartRequest {
	declare ["constructor"]: typeof InstanceStartRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "instance" as const;
	static permission = "core.instance.start" as const;

	constructor(
		public save?: string,
	) { }

	static jsonSchema = Type.Object({
		"save": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.save);
	}
}

export class SaveDetails {
	constructor(
		public instanceId: number,
		public type: "file" | "directory" | "special",
		public name: string,
		public size: number,
		public mtimeMs: number,
		public loaded: boolean,
		public loadByDefault: boolean,
		/** Millisecond Unix timestamp this entry was last updated at */
		public updatedAt: number,
		public isDeleted: boolean,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"type": StringEnum(["file", "directory", "special"]),
		"name": Type.String(),
		"size": Type.Integer(),
		"mtimeMs": Type.Number(),
		"loaded": Type.Boolean(),
		"loadByDefault": Type.Boolean(),
		"updatedAt": Type.Number(),
		"isDeleted": Type.Boolean(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.instanceId,
			json.type,
			json.name,
			json.size,
			json.mtimeMs,
			json.loaded,
			json.loadByDefault,
			json.updatedAt,
			json.isDeleted,
		);
	}

	/** Concatenation of instance id and name forming a unique string for this save */
	get id() {
		return `${this.instanceId}/${this.name}`;
	}

	/**
	 * Compare this save with another save.
	 * @param other - save to compare with.
	 * @returns true if this save is identical to the provided save
	 */
	equals(other: SaveDetails) {
		// Note that updatedAt is not included in the equality check because
		// instances send the whole list of saves with updatedAt set to zero
		// to the controller whenever any save changes and this equals check
		// is used to filter whether a save was updated.
		return (
			this.instanceId === other.instanceId
			&& this.type === other.type
			&& this.name === other.name
			&& this.size === other.size
			&& this.mtimeMs === other.mtimeMs
			&& this.loaded === other.loaded
			&& this.loadByDefault === other.loadByDefault
			&& this.isDeleted === other.isDeleted
		);
	}
}

export class InstanceSaveDetailsListRequest {
	declare ["constructor"]: typeof InstanceSaveDetailsListRequest;
	static type = "request" as const;
	static src = ["control", "host"] as const;
	static dst = ["controller", "instance"] as const;
	static permission = "core.instance.save.list" as const;
	static Response = jsonArray(SaveDetails);
}

export class InstanceSaveDetailsUpdatesEvent {
	declare ["constructor"]: typeof InstanceSaveDetailsUpdatesEvent;
	static type = "event" as const;
	static src = ["instance", "host", "controller"] as const;
	static dst = ["controller", "control"] as const;
	static permission = "core.instance.save.list.subscribe" as const;

	constructor(
		public updates: SaveDetails[],
		/**
		 * Present if this update was sent by a host and updates contains all
		 * saves of the given instance.
		 */
		public instanceId?: number,
	) { }

	static jsonSchema = Type.Object({
		"updates": Type.Array(SaveDetails.jsonSchema),
		"instanceId": Type.Optional(Type.Integer()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates.map(i => SaveDetails.fromJSON(i)), json.instanceId);
	}
}

export class InstanceCreateSaveRequest {
	declare ["constructor"]: typeof InstanceCreateSaveRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "instance" as const;
	static permission = "core.instance.save.create" as const;

	constructor(
		public name: string,
		public seed?: number,
		public mapGenSettings?: object,
		public mapSettings?: object,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"seed": Type.Optional(Type.Integer()),
		"mapGenSettings": Type.Optional(Type.Object({})),
		"mapSettings": Type.Optional(Type.Object({})),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.seed, json.mapGenSettings, json.mapSettings);
	}
}

export class InstanceRenameSaveRequest {
	declare ["constructor"]: typeof InstanceRenameSaveRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = ["controller", "host"] as const;
	static permission = "core.instance.save.rename" as const;

	constructor(
		public instanceId: number,
		public oldName: string,
		public newName: string,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"oldName": Type.String(),
		"newName": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.oldName, json.newName);
	}
}

export class InstanceCopySaveRequest {
	declare ["constructor"]: typeof InstanceCopySaveRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = ["controller", "host"] as const;
	static permission = "core.instance.save.copy" as const;

	constructor(
		public instanceId: number,
		public source: string,
		public destination: string,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"source": Type.String(),
		"destination": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.source, json.destination);
	}
}

export class InstanceDeleteSaveRequest {
	declare ["constructor"]: typeof InstanceDeleteSaveRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = ["controller", "host"] as const;
	static permission = "core.instance.save.delete" as const;

	constructor(
		public instanceId: number,
		public name: string,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"name": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.name);
	}
}

export class InstanceDownloadSaveRequest {
	declare ["constructor"]: typeof InstanceDownloadSaveRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.save.download" as const;

	constructor(
		public instanceId: number,
		public name: string,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"name": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.name);
	}

	static Response = JsonString;
}

export class InstanceTransferSaveRequest {
	declare ["constructor"]: typeof InstanceTransferSaveRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = ["controller", "host"] as const;
	static permission(user: IControllerUser, message: MessageRequest) {
		user.checkPermission("core.instance.save.transfer");
		if (typeof message.data === "object" && message.data !== null) {
			const data = message.data as { copy: boolean, sourceName: string, targetName: string };
			if (data.copy) {
				user.checkPermission("core.instance.save.copy");
			} else if (data.sourceName !== data.targetName) {
				user.checkPermission("core.instance.save.rename");
			}
		}
	}

	constructor(
		public sourceInstanceId: number,
		public sourceName: string,
		public targetInstanceId: number,
		public targetName: string,
		public copy: boolean,
	) { }

	static jsonSchema = Type.Object({
		"sourceInstanceId": Type.Number(),
		"sourceName": Type.String(),
		"targetInstanceId": Type.Number(),
		"targetName": Type.String(),
		"copy": Type.Boolean(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.sourceInstanceId, json.sourceName, json.targetInstanceId, json.targetName, json.copy
		);
	}

	static Response = JsonString;
}


export class InstancePullSaveRequest {
	declare ["constructor"]: typeof InstancePullSaveRequest;
	static type = "request" as const;
	static src = "controller" as const;
	static dst = "host" as const;

	constructor(
		public instanceId: number,
		public streamId: string,
		public name: string,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"streamId": Type.String(),
		"name": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.streamId, json.name);
	}

	static Response = JsonString;
}

export class InstancePushSaveRequest {
	declare ["constructor"]: typeof InstancePushSaveRequest;
	static type = "request" as const;
	static src = "controller" as const;
	static dst = "host" as const;

	constructor(
		public instanceId: number,
		public streamId: string,
		public name: string,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"streamId": Type.String(),
		"name": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.streamId, json.name);
	}
}

export class InstanceLoadScenarioRequest {
	declare ["constructor"]: typeof InstanceLoadScenarioRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "instance" as const;
	static permission = "core.instance.load_scenario" as const;

	constructor(
		public scenario: string,
		public seed?: number,
		public mapGenSettings?: object,
		public mapSettings?: object,
	) { }

	static jsonSchema = Type.Object({
		"scenario": Type.String(),
		"seed": Type.Optional(Type.Integer()),
		"mapGenSettings": Type.Optional(Type.Object({})),
		"mapSettings": Type.Optional(Type.Object({})),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.scenario, json.seed, json.mapGenSettings, json.mapSettings);
	}
}

export class InstanceExportDataRequest {
	declare ["constructor"]: typeof InstanceExportDataRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "instance" as const;
	static permission = "core.instance.export_data" as const;
}

export class InstanceExtractPlayersRequest {
	declare ["constructor"]: typeof InstanceExtractPlayersRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "instance" as const;
	static permission = "core.instance.extract_players" as const;
}

export class InstanceStopRequest {
	declare ["constructor"]: typeof InstanceStopRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "instance" as const;
	static permission = "core.instance.stop" as const;
}

export class InstanceKillRequest {
	declare ["constructor"]: typeof InstanceKillRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "instance" as const;
	static permission = "core.instance.kill" as const;
}

export class InstanceDeleteRequest {
	declare ["constructor"]: typeof InstanceDeleteRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.delete" as const;

	constructor(
		public instanceId: number,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId);
	}
}

export class InstanceDeleteInternalRequest {
	declare ["constructor"]: typeof InstanceDeleteInternalRequest;
	static type = "request" as const;
	static src = "controller" as const;
	static dst = "host" as const;

	constructor(
		public instanceId: number,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId);
	}
}

export class InstanceSendRconRequest {
	declare ["constructor"]: typeof InstanceSendRconRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "instance" as const;
	static permission = "core.instance.send_rcon" as const;

	constructor(
		public command: string,
	) { }

	static jsonSchema = Type.Object({
		"command": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.command);
	}

	static Response = JsonString;
}

export class HostInstanceUpdate {
	constructor(
		public config: Static<typeof InstanceConfig.jsonSchema>,
		public status: InstanceStatus,
		public gamePort: undefined | number,
	) { }

	static jsonSchema = Type.Object({
		"config": InstanceConfig.jsonSchema,
		"status": StringEnum([
			"stopped", "starting", "running", "stopping", "creating_save", "exporting_data",
		]),
		"gamePort": Type.Optional(Type.Number()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.config, json.status, json.gamePort);
	}
}

export class InstancesUpdateRequest {
	declare ["constructor"]: typeof InstancesUpdateRequest;
	static type = "request" as const;
	static src = "host" as const;
	static dst = "controller" as const;

	constructor(
		public instances: HostInstanceUpdate[],
	) { }

	static jsonSchema = Type.Array(HostInstanceUpdate.jsonSchema);

	toJSON() {
		return this.instances;
	}

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.map(i => HostInstanceUpdate.fromJSON(i)));
	}
}

export class InstanceAssignInternalRequest {
	declare ["constructor"]: typeof InstanceAssignInternalRequest;
	static type = "request" as const;
	static src = "controller" as const;
	static dst = "host" as const;

	constructor(
		public instanceId: number,
		public config: Static<typeof InstanceConfig.jsonSchema>,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"config": InstanceConfig.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.config);
	}
}

export class InstanceUnassignInternalRequest {
	declare ["constructor"]: typeof InstanceUnassignInternalRequest;
	static type = "request" as const;
	static src = "controller" as const;
	static dst = "host" as const;

	constructor(
		public instanceId: number,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId);
	}
}

export class InstanceInitialisedEvent {
	declare ["constructor"]: typeof InstanceInitialisedEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "host" as const;

	constructor(
		public plugins: Record<string, string>,
	) { }

	static jsonSchema = Type.Object({
		"plugins": Type.Record(Type.String(), Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.plugins);
	}
}

export class InstanceStatusChangedEvent {
	declare ["constructor"]: typeof InstanceStatusChangedEvent;
	static type = "event" as const;
	static src = ["instance", "host"] as const;
	static dst = "controller" as const;

	constructor(
		public instanceId: number,
		public status: InstanceStatus,
		public gamePort?: number,
	) { }

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"status": StringEnum([
			"stopped", "starting", "running", "stopping", "creating_save", "exporting_data",
		]),
		"gamePort": Type.Optional(Type.Integer()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.status, json.gamePort);
	}
}

export class InstanceDetailsChangedEvent {
	declare ["constructor"]: typeof InstanceDetailsChangedEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;

	constructor(
		public details: InstanceDetails,
	) { }

	static jsonSchema = InstanceDetails.jsonSchema;

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(InstanceDetails.fromJSON(json));
	}
}

export class InstanceBanlistUpdateEvent {
	declare ["constructor"]: typeof InstanceBanlistUpdateEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "instance" as const;

	constructor(
		public name: string,
		public banned: boolean,
		public reason: string,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"banned": Type.Boolean(),
		"reason": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.banned, json.reason);
	}
}

export class InstanceAdminlistUpdateEvent {
	declare ["constructor"]: typeof InstanceAdminlistUpdateEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "instance" as const;

	constructor(
		public name: string,
		public admin: boolean,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"admin": Type.Boolean(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.admin);
	}
}

export class InstanceWhitelistUpdateEvent {
	declare ["constructor"]: typeof InstanceWhitelistUpdateEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "instance" as const;

	constructor(
		public name: string,
		public whitelisted: boolean,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"whitelisted": Type.Boolean(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.whitelisted);
	}
}

export class InstancePlayerUpdateEvent {
	declare ["constructor"]: typeof InstancePlayerUpdateEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;

	constructor(
		public type: "join" | "leave" | "import",
		public name: string,
		public stats: PlayerStats,
		public reason?: string,
	) { }

	static jsonSchema = Type.Object({
		"type": StringEnum(["join", "leave", "import"]),
		"name": Type.String(),
		"reason": Type.Optional(Type.String()),
		"stats": Type.Unsafe<object>(PlayerStats.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.type, json.name, PlayerStats.fromJSON(json.stats), json.reason);
	}
}
