import { Type, type Static } from "@sinclair/typebox";
import PlayerStats from "./PlayerStats.js";
import { JsonString, StringEnum, jsonArray, plainJson } from "./composites.js";
import { InstanceConfig } from "../config/index.js";
import type { IUser } from "./UserDetails.js";
import type { MessageRequest } from "./messages_core.js";
import { CollectorResultSerialized } from "../prometheus.js";
import { type TargetVersion, TargetVersionSchema, type PartialVersion, PartialVersionSchema } from "./version.js";
import InstanceDetails, { InstanceStatus } from "./InstanceDetails.js";

export class InstanceDetailsGetRequest {
	declare ["constructor"]: typeof InstanceDetailsGetRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.get" as const;

	instanceId: number;

	constructor(
		instanceId: number,
	) {
		this.instanceId = instanceId;
	}

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

	updates: InstanceDetails[];

	constructor(
		updates: InstanceDetails[],
	) {
		this.updates = updates;
	}

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

	config: Static<typeof InstanceConfig.jsonSchema>;
	cloneFromId?: number;

	constructor(
		config: Static<typeof InstanceConfig.jsonSchema>,
		cloneFromId?: number,
	) {
		this.config = config;
		this.cloneFromId = cloneFromId;
	}

	static jsonSchema = Type.Object({
		"config": InstanceConfig.jsonSchema,
		"cloneFromId": Type.Optional(Type.Number()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.config, json.cloneFromId);
	}
}

export class InstanceConfigGetRequest {
	declare ["constructor"]: typeof InstanceConfigGetRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.get_config" as const;
	static Response = plainJson(InstanceConfig.jsonSchema);

	instanceId: number;

	constructor(
		instanceId: number,
	) {
		this.instanceId = instanceId;
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId);
	}
}

export class InstanceConfigSetRequest {
	declare ["constructor"]: typeof InstanceConfigSetRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.update_config" as const;

	instanceId: number;
	fields: Record<string, string | Record<string, unknown>>;

	constructor(
		instanceId: number,
		fields: Record<string, string | Record<string, unknown>>,
	) {
		this.instanceId = instanceId;
		this.fields = fields;
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"fields": Type.Record(Type.String(), Type.Union([
			Type.String(), Type.Record(Type.String(), Type.Unknown()),
		])),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.fields);
	}
}

export class InstanceConfigSetFieldRequest {
	declare ["constructor"]: typeof InstanceConfigSetFieldRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.update_config" as const;

	instanceId: number;
	field: string;
	value: string;

	constructor(
		instanceId: number,
		field: string,
		value: string,
	) {
		this.instanceId = instanceId;
		this.field = field;
		this.value = value;
	}

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

	instanceId: number;
	field: string;
	prop: string;
	value?: unknown;

	constructor(
		instanceId: number,
		field: string,
		prop: string,
		value?: unknown,
	) {
		this.instanceId = instanceId;
		this.field = field;
		this.prop = prop;
		this.value = value;
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"field": Type.String(),
		"prop": Type.String(),
		"value": Type.Optional(Type.Unknown()),
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

	instanceId: number;
	hostId?: number;

	constructor(
		instanceId: number,
		hostId?: number,
	) {
		this.instanceId = instanceId;
		this.hostId = hostId;
	}

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
		results: CollectorResultSerialized[];

		constructor(
			results: CollectorResultSerialized[],
		) {
			this.results = results;
		}

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

	save?: string;

	constructor(
		save?: string,
	) {
		this.save = save;
	}

	static jsonSchema = Type.Object({
		"save": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.save);
	}
}

export class InstanceRestartRequest {
	declare ["constructor"]: typeof InstanceRestartRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "instance" as const;
	static permission = "core.instance.restart" as const;

	save?: string;

	constructor(
		save?: string,
	) {
		this.save = save;
	}

	static jsonSchema = Type.Object({
		"save": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.save);
	}
}

export class SaveDetails {
	instanceId: number;
	type: "file" | "directory" | "special";
	name: string;
	size: number;
	mtimeMs: number;
	loaded: boolean;
	loadByDefault: boolean;
	/** Millisecond Unix timestamp this entry was last updated at */
	updatedAtMs: number;
	isDeleted: boolean;

	constructor(
		instanceId: number,
		type: "file" | "directory" | "special",
		name: string,
		size: number,
		mtimeMs: number,
		loaded: boolean,
		loadByDefault: boolean,
		/** {@inheritDoc updatedAtMs} */
		updatedAtMs: number,
		isDeleted: boolean,
	) {
		this.instanceId = instanceId;
		this.type = type;
		this.name = name;
		this.size = size;
		this.mtimeMs = mtimeMs;
		this.loaded = loaded;
		this.loadByDefault = loadByDefault;
		this.updatedAtMs = updatedAtMs;
		this.isDeleted = isDeleted;
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"type": StringEnum(["file", "directory", "special"]),
		"name": Type.String(),
		"size": Type.Integer(),
		"mtimeMs": Type.Number(),
		"loaded": Type.Boolean(),
		"loadByDefault": Type.Boolean(),
		"updatedAtMs": Type.Number(),
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
			json.updatedAtMs,
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
		// Note that updatedAtMs is not included in the equality check because
		// instances send the whole list of saves with updatedAtMs set to zero
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
	static permission = "core.instance.save.subscribe" as const;

	updates: SaveDetails[];
	/**
	 * Present if this update was sent by a host and updates contains all
	 * saves of the given instance.
	 */
	instanceId?: number;

	constructor(
		updates: SaveDetails[],
		/** {@inheritDoc instanceId} */
		instanceId?: number,
	) {
		this.updates = updates;
		this.instanceId = instanceId;
	}

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
	static src = ["control", "controller"] as const;
	static dst = "instance" as const;
	static permission = "core.instance.save.create" as const;

	name: string;
	seed?: number;
	mapGenSettings?: object;
	mapSettings?: object;

	constructor(
		name: string,
		seed?: number,
		mapGenSettings?: object,
		mapSettings?: object,
	) {
		this.name = name;
		this.seed = seed;
		this.mapGenSettings = mapGenSettings;
		this.mapSettings = mapSettings;
	}

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

export class InstanceSaveGameRequest {
	declare ["constructor"]: typeof InstanceSaveGameRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "instance" as const;
	static permission = "core.instance.save.create" as const;
}

export class InstanceRenameSaveRequest {
	declare ["constructor"]: typeof InstanceRenameSaveRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = ["controller", "host"] as const;
	static permission = "core.instance.save.rename" as const;

	instanceId: number;
	oldName: string;
	newName: string;

	constructor(
		instanceId: number,
		oldName: string,
		newName: string,
	) {
		this.instanceId = instanceId;
		this.oldName = oldName;
		this.newName = newName;
	}

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

	instanceId: number;
	source: string;
	destination: string;

	constructor(
		instanceId: number,
		source: string,
		destination: string,
	) {
		this.instanceId = instanceId;
		this.source = source;
		this.destination = destination;
	}

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

	instanceId: number;
	name: string;

	constructor(
		instanceId: number,
		name: string,
	) {
		this.instanceId = instanceId;
		this.name = name;
	}

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

	instanceId: number;
	name: string;

	constructor(
		instanceId: number,
		name: string,
	) {
		this.instanceId = instanceId;
		this.name = name;
	}

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

	sourceInstanceId: number;
	sourceName: string;
	targetInstanceId: number;
	targetName: string;
	copy: boolean;
	static permission(user: IUser, message: MessageRequest) {
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
		sourceInstanceId: number,
		sourceName: string,
		targetInstanceId: number,
		targetName: string,
		copy: boolean,
	) {
		this.sourceInstanceId = sourceInstanceId;
		this.sourceName = sourceName;
		this.targetInstanceId = targetInstanceId;
		this.targetName = targetName;
		this.copy = copy;
	}

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

	instanceId: number;
	streamId: string;
	name: string;

	constructor(
		instanceId: number,
		streamId: string,
		name: string,
	) {
		this.instanceId = instanceId;
		this.streamId = streamId;
		this.name = name;
	}

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

	instanceId: number;
	streamId: string;
	name: string;

	constructor(
		instanceId: number,
		streamId: string,
		name: string,
	) {
		this.instanceId = instanceId;
		this.streamId = streamId;
		this.name = name;
	}

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
	static src = ["control", "controller"] as const;
	static dst = "instance" as const;
	static permission = "core.instance.load_scenario" as const;

	scenario: string;
	seed?: number;
	mapGenSettings?: object;
	mapSettings?: object;

	constructor(
		scenario: string,
		seed?: number,
		mapGenSettings?: object,
		mapSettings?: object,
	) {
		this.scenario = scenario;
		this.seed = seed;
		this.mapGenSettings = mapGenSettings;
		this.mapSettings = mapSettings;
	}

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
	static src = ["control", "controller"] as const;
	static dst = "instance" as const;
	static permission = "core.instance.export_data" as const;
}

export class InstanceExtractPlayersRequest {
	declare ["constructor"]: typeof InstanceExtractPlayersRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "instance" as const;
	static permission = "core.instance.extract_players" as const;
}

export class InstanceStopRequest {
	declare ["constructor"]: typeof InstanceStopRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "instance" as const;
	static permission = "core.instance.stop" as const;
}

export class InstanceKillRequest {
	declare ["constructor"]: typeof InstanceKillRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "instance" as const;
	static permission = "core.instance.kill" as const;
}

export class InstanceDeleteRequest {
	declare ["constructor"]: typeof InstanceDeleteRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.instance.delete" as const;

	instanceId: number;

	constructor(
		instanceId: number,
	) {
		this.instanceId = instanceId;
	}

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

	instanceId: number;

	constructor(
		instanceId: number,
	) {
		this.instanceId = instanceId;
	}

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
	static src = ["control", "controller"] as const;
	static dst = "instance" as const;
	static permission = "core.instance.send_rcon" as const;

	command: string;

	constructor(
		command: string,
	) {
		this.command = command;
	}

	static jsonSchema = Type.Object({
		"command": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.command);
	}

	static Response = JsonString;
}

export class HostInstanceUpdate {
	config: Static<typeof InstanceConfig.jsonSchema>;
	status: InstanceStatus;
	gamePort: number | undefined;
	factorioVersion: PartialVersion | undefined;

	constructor(
		config: Static<typeof InstanceConfig.jsonSchema>,
		status: InstanceStatus,
		gamePort: number | undefined,
		factorioVersion: PartialVersion | undefined,
	) {
		this.config = config;
		this.status = status;
		this.gamePort = gamePort;
		this.factorioVersion = factorioVersion;
	}

	static jsonSchema = Type.Object({
		"config": InstanceConfig.jsonSchema,
		"status": StringEnum([
			"stopped", "starting", "running", "stopping", "creating_save", "exporting_data",
		]),
		"gamePort": Type.Optional(Type.Number()),
		"factorioVersion": Type.Optional(PartialVersionSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.config, json.status, json.gamePort, json.factorioVersion);
	}
}

export class InstancesUpdateRequest {
	declare ["constructor"]: typeof InstancesUpdateRequest;
	static type = "request" as const;
	static src = "host" as const;
	static dst = "controller" as const;

	instances: HostInstanceUpdate[];

	constructor(
		instances: HostInstanceUpdate[],
	) {
		this.instances = instances;
	}

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

	instanceId: number;
	config: Static<typeof InstanceConfig.jsonSchema>;

	constructor(
		instanceId: number,
		config: Static<typeof InstanceConfig.jsonSchema>,
	) {
		this.instanceId = instanceId;
		this.config = config;
	}

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

	instanceId: number;

	constructor(
		instanceId: number,
	) {
		this.instanceId = instanceId;
	}

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

	plugins: Record<string, string>;

	constructor(
		plugins: Record<string, string>,
	) {
		this.plugins = plugins;
	}

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

	instanceId: number;
	status: InstanceStatus;
	gamePort?: number;
	factorioVersion?: TargetVersion;

	constructor(
		instanceId: number,
		status: InstanceStatus,
		gamePort?: number,
		factorioVersion?: TargetVersion,
	) {
		this.instanceId = instanceId;
		this.status = status;
		this.gamePort = gamePort;
		this.factorioVersion = factorioVersion;
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"status": StringEnum([
			"stopped", "starting", "running", "stopping", "creating_save", "exporting_data",
		]),
		"gamePort": Type.Optional(Type.Integer()),
		"factorioVersion": Type.Optional(TargetVersionSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.status, json.gamePort, json.factorioVersion);
	}
}

export class InstanceDetailsChangedEvent {
	declare ["constructor"]: typeof InstanceDetailsChangedEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;

	details: InstanceDetails;

	constructor(
		details: InstanceDetails,
	) {
		this.details = details;
	}

	static jsonSchema = InstanceDetails.jsonSchema;

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(InstanceDetails.fromJSON(json));
	}
}

export class InstanceBanlistUpdateEvent {
	declare ["constructor"]: typeof InstanceBanlistUpdateEvent;
	static type = "event" as const;
	static src = ["controller", "host", "instance"] as const;
	static dst = "instance" as const;

	name: string;
	banned: boolean;
	reason: string;

	constructor(
		name: string,
		banned: boolean,
		reason: string,
	) {
		this.name = name;
		this.banned = banned;
		this.reason = reason;
	}

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
	static src = ["controller", "host", "instance"] as const;
	static dst = "instance" as const;

	name: string;
	admin: boolean;

	constructor(
		name: string,
		admin: boolean,
	) {
		this.name = name;
		this.admin = admin;
	}

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
	static src = ["controller", "host", "instance"] as const;
	static dst = "instance" as const;

	name: string;
	whitelisted: boolean;

	constructor(
		name: string,
		whitelisted: boolean,
	) {
		this.name = name;
		this.whitelisted = whitelisted;
	}

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

	type: "join" | "leave" | "import";
	name: string;
	stats: PlayerStats;
	reason?: string;

	constructor(
		type: "join" | "leave" | "import",
		name: string,
		stats: PlayerStats,
		reason?: string,
	) {
		this.type = type;
		this.name = name;
		this.stats = stats;
		this.reason = reason;
	}

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
