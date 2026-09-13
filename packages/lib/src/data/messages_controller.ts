import { Type, type Static } from "@sinclair/typebox";
import { JsonString, StringEnum, StringKey, plainJson } from "./composites.ts";
import { levels } from "../logging.ts";
import { ControllerConfig, HostConfig } from "../config/index.ts";
import { ExternalFactorioVersionSchema, LatestReleasesSchema } from "../external/index.ts";

export class ControllerStopRequest {
	declare ["constructor"]: typeof ControllerStopRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.controller.stop" as const;
}

export class ControllerRestartRequest {
	declare ["constructor"]: typeof ControllerRestartRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.controller.restart" as const;
}

export class ControllerUpdateRequest {
	declare ["constructor"]: typeof ControllerUpdateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.controller.update" as const;
}

export class ControllerConfigGetRequest {
	declare ["constructor"]: typeof ControllerConfigGetRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.controller.get_config" as const;
	static Response = plainJson(ControllerConfig.jsonSchema);
}

export class ControllerConfigSetRequest {
	declare ["constructor"]: typeof ControllerConfigSetRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.controller.update_config" as const;

	fields: Record<string, string | Record<string, unknown>>;

	constructor(
		fields: Record<string, string | Record<string, unknown>>,
	) {
		this.fields = fields;
	}

	static jsonSchema = Type.Object({
		"fields": Type.Record(Type.String(), Type.Union([
			Type.String(), Type.Record(Type.String(), Type.Unknown()),
		])),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.fields);
	}
}

export class ControllerConfigSetFieldRequest {
	declare ["constructor"]: typeof ControllerConfigSetFieldRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.controller.update_config" as const;

	field: string;
	value: string;

	constructor(
		field: string,
		value: string,
	) {
		this.field = field;
		this.value = value;
	}

	static jsonSchema = Type.Object({
		"field": Type.String(),
		"value": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.field, json.value);
	}
}

export class ControllerConfigSetPropRequest {
	declare ["constructor"]: typeof ControllerConfigSetPropRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.controller.update_config" as const;

	field: string;
	prop: string;
	value?: unknown;

	constructor(
		field: string,
		prop: string,
		value?: unknown,
	) {
		this.field = field;
		this.prop = prop;
		this.value = value;
	}

	static jsonSchema = Type.Object({
		"field": Type.String(),
		"prop": Type.String(),
		"value": Type.Optional(Type.Unknown()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.field, json.prop, json.value);
	}
}

export class HostGenerateTokenRequest {
	declare ["constructor"]: typeof HostGenerateTokenRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.host.generate_token" as const;

	hostId?: number;

	constructor(
		hostId?: number,
	) {
		this.hostId = hostId;
	}

	static jsonSchema = Type.Object({
		"hostId": Type.Optional(Type.Integer()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.hostId);
	}

	static Response = JsonString;
}

export class HostConfigCreateRequest {
	declare ["constructor"]: typeof HostConfigCreateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.host.create_config" as const;

	id: number | undefined;
	name: string | undefined;
	generateToken: boolean;

	constructor(
		id: number | undefined,
		name: string | undefined,
		generateToken: boolean,
	) {
		this.id = id;
		this.name = name;
		this.generateToken = generateToken;
	}

	static jsonSchema = Type.Object({
		"id": Type.Optional(Type.Integer()),
		"name": Type.Optional(Type.String()),
		"generateToken": Type.Boolean(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.id, json.name, json.generateToken);
	}

	static Response = plainJson(HostConfig.jsonSchema);
}

export class GetFactorioCredentialsRequest {
	declare ["constructor"]: typeof GetFactorioCredentialsRequest;
	static type = "request" as const;
	static src = ["host", "instance"] as const;
	static dst = "controller" as const;

	static Response = plainJson(Type.Object({
		"username": Type.Optional(Type.String()),
		"token": Type.Optional(Type.String()),
	}));
}

export class LogSetSubscriptionsRequest {
	declare ["constructor"]: typeof LogSetSubscriptionsRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.log.follow" as const;

	all?: boolean;
	controller?: boolean;
	hostIds?: number[];
	instanceIds?: number[];
	maxLevel?: keyof typeof levels;

	constructor(
		all?: boolean,
		controller?: boolean,
		hostIds?: number[],
		instanceIds?: number[],
		maxLevel?: keyof typeof levels,
	) {
		this.all = all;
		this.controller = controller;
		this.hostIds = hostIds;
		this.instanceIds = instanceIds;
		this.maxLevel = maxLevel;
	}

	static jsonSchema = Type.Object({
		all: Type.Optional(Type.Boolean()),
		controller: Type.Optional(Type.Boolean()),
		hostIds: Type.Array(Type.Integer()),
		instanceIds: Type.Array(Type.Integer()),
		maxLevel: Type.Optional(StringEnum(Object.keys(levels) as (keyof typeof levels)[])),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.all, json.controller, json.hostIds, json.instanceIds, json.maxLevel);
	}
}

export class LogQueryRequest {
	declare ["constructor"]: typeof LogQueryRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.log.query" as const;

	all: boolean;
	controller: boolean;
	hostIds: number[];
	instanceIds: number[];
	maxLevel: undefined | keyof typeof levels;
	limit: number;
	order: "asc" | "desc";

	constructor(
		all: boolean,
		controller: boolean,
		hostIds: number[],
		instanceIds: number[],
		maxLevel: undefined | keyof typeof levels,
		limit: number,
		order: "asc" | "desc",
	) {
		this.all = all;
		this.controller = controller;
		this.hostIds = hostIds;
		this.instanceIds = instanceIds;
		this.maxLevel = maxLevel;
		this.limit = limit;
		this.order = order;
	}

	static jsonSchema = Type.Object({
		all: Type.Boolean(),
		controller: Type.Boolean(),
		hostIds: Type.Array(Type.Integer()),
		instanceIds: Type.Array(Type.Integer()),
		maxLevel: Type.Optional(StringEnum(Object.keys(levels) as (keyof typeof levels)[])),
		limit: Type.Integer(),
		order: StringEnum(["asc", "desc"]),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.all, json.controller, json.hostIds, json.instanceIds, json.maxLevel, json.limit, json.order
		);
	}

	static Response = class Response {
		log: object[];

		constructor(
			log: object[],
		) {
			this.log = log;
		}

		static jsonSchema = Type.Object({
			"log": Type.Array(Type.Object({})),
		});

		static fromJSON(json: Static<typeof this.jsonSchema>) {
			return new this(json.log);
		}
	};
}

export class LogMessageEvent {
	declare ["constructor"]: typeof LogMessageEvent;
	static type = "event" as const;
	static src = ["host", "controller"] as const;
	static dst = ["controller", "control"] as const;

	info: { level: keyof typeof levels, message: string };

	constructor(
		info: { level: keyof typeof levels, message: string },
	) {
		this.info = info;
	}

	static jsonSchema = Type.Object({
		"info": Type.Object({
			"level": StringKey(levels),
			"message": Type.String(),
		}),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.info);
	}
}

export class SystemInfo {
	/**
	 * Id of the host these metrics originate from, or the string
	 * "controller" if these metrics are for the controller.
	 */
	id: number | "controller";
	hostname: string;
	node: string;
	kernel: string;
	machine: string;
	cpuModel: string;
	coreRatios: number[];
	memoryCapacity: number;
	memoryAvailable: number;
	diskCapacity: number;
	diskAvailable: number;
	canRestart: boolean;
	restartRequired: boolean;
	systemStartedAtMs: number;
	processStartedAtMs: number;
	/** Millisecond Unix timestamp this entry was last updated at */
	updatedAtMs: number;
	isDeleted: boolean;

	constructor(
		/** {@inheritDoc id} */
		id: number | "controller",
		hostname: string,
		node: string,
		kernel: string,
		machine: string,
		cpuModel: string,
		coreRatios: number[],
		memoryCapacity: number,
		memoryAvailable: number,
		diskCapacity: number,
		diskAvailable: number,
		canRestart: boolean,
		restartRequired: boolean,
		systemStartedAtMs: number,
		processStartedAtMs: number,
		/** {@inheritDoc updatedAtMs} */
		updatedAtMs: number,
		isDeleted: boolean,
	) {
		this.id = id;
		this.hostname = hostname;
		this.node = node;
		this.kernel = kernel;
		this.machine = machine;
		this.cpuModel = cpuModel;
		this.coreRatios = coreRatios;
		this.memoryCapacity = memoryCapacity;
		this.memoryAvailable = memoryAvailable;
		this.diskCapacity = diskCapacity;
		this.diskAvailable = diskAvailable;
		this.canRestart = canRestart;
		this.restartRequired = restartRequired;
		this.systemStartedAtMs = systemStartedAtMs;
		this.processStartedAtMs = processStartedAtMs;
		this.updatedAtMs = updatedAtMs;
		this.isDeleted = isDeleted;
	}

	static jsonSchema = Type.Object({
		"id": Type.Union([Type.Number(), Type.Literal("controller")]),
		"hostname": Type.String(),
		"node": Type.String(),
		"kernel": Type.String(),
		"machine": Type.String(),
		"cpuModel": Type.String(),
		"coreRatios": Type.Array(Type.Number()),
		"memoryCapacity": Type.Number(),
		"memoryAvailable": Type.Number(),
		"diskCapacity": Type.Number(),
		"diskAvailable": Type.Number(),
		"canRestart": Type.Boolean(),
		"restartRequired": Type.Boolean(),
		"systemStartedAtMs": Type.Number(),
		"processStartedAtMs": Type.Number(),
		"updatedAtMs": Type.Number(),
		"isDeleted": Type.Boolean(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.id,
			json.hostname,
			json.node,
			json.kernel,
			json.machine,
			json.cpuModel,
			json.coreRatios,
			json.memoryCapacity,
			json.memoryAvailable,
			json.diskCapacity,
			json.diskAvailable,
			json.canRestart,
			json.restartRequired,
			json.systemStartedAtMs,
			json.processStartedAtMs,
			json.updatedAtMs,
			json.isDeleted,
		);
	}

	get cpuCapacity() {
		return this.coreRatios.length;
	}

	get cpuUsed() {
		return this.coreRatios.reduce((a, b) => a + b, 0);
	}

	get cpuAvailable() {
		return this.cpuCapacity - this.cpuUsed;
	}

	get cpuRatio() {
		return this.cpuUsed / this.cpuCapacity;
	}

	get memoryUsed() {
		return this.memoryCapacity - this.memoryAvailable;
	}

	get memoryRatio() {
		return (this.memoryCapacity - this.memoryAvailable) / this.memoryCapacity;
	}

	get diskUsed() {
		return this.diskCapacity - this.diskAvailable;
	}

	get diskRatio() {
		return (this.diskCapacity - this.diskAvailable) / this.diskCapacity;
	}
}

export class SystemInfoRequest {
	declare ["constructor"]: typeof SystemInfoRequest;
	static type = "request" as const;
	static src = "controller" as const;
	static dst = "host" as const;
	static Response = SystemInfo;
}

export class SystemInfoUpdateEvent {
	declare ["constructor"]: typeof SystemInfoUpdateEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.system.subscribe" as const;

	updates: SystemInfo[];

	constructor(
		updates: SystemInfo[],
	) {
		this.updates = updates;
	}

	static jsonSchema = Type.Object({
		"updates": Type.Array(SystemInfo.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates.map(update => SystemInfo.fromJSON(update)));
	}
}

export class DebugDumpWsRequest {
	declare ["constructor"]: typeof DebugDumpWsRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.debug.dump_ws" as const;
}

export class DebugWsMessageEvent {
	declare ["constructor"]: typeof DebugWsMessageEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;

	direction: string;
	content: string;

	constructor(
		direction: string,
		content: string,
	) {
		this.direction = direction;
		this.content = content;
	}

	static jsonSchema = Type.Object({
		"direction": Type.String(),
		"content": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.direction, json.content);
	}
}

export class FactorioVersionsRequest {
	declare ["constructor"]: typeof FactorioVersionsRequest;
	static type = "request" as const;
	static src = ["control", "instance"] as const;
	static dst = "controller" as const;
	static permission = "core.external.get_factorio_versions" as const;

	maxAgeMs: number;

	constructor(
		maxAgeMs: number = 5 * 60 * 1000, // Default 5 minutes,
	) {
		this.maxAgeMs = maxAgeMs;
	}

	static jsonSchema = Type.Object({
		"maxAgeMs": Type.Number(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.maxAgeMs);
	}

	static Response = plainJson(Type.Array(ExternalFactorioVersionSchema));
}

export class LatestReleasesRequest {
	declare ["constructor"]: typeof LatestReleasesRequest;
	static type = "request" as const;
	static src = ["control", "instance"] as const;
	static dst = "controller" as const;
	static permission = "core.external.get_latest_releases" as const;

	maxAgeMs: number;

	constructor(
		maxAgeMs: number = 5 * 60 * 1000, // Default 5 minutes,
	) {
		this.maxAgeMs = maxAgeMs;
	}

	static jsonSchema = Type.Object({
		"maxAgeMs": Type.Number(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.maxAgeMs);
	}

	static Response = plainJson(LatestReleasesSchema);
}
