import { Type, type Static } from "@sinclair/typebox";
import { jsonArray, plainJson, StringEnum } from "./composites.js";
import { CollectorResultSerialized } from "../prometheus.js";
import { HostConfig } from "../config/definitions.js";
import HostDetails from "./HostDetails.js";

export class HostStopRequest {
	declare ["constructor"]: typeof HostStopRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "host" as const;
	static permission = "core.host.stop" as const;
}

export class HostRestartRequest {
	declare ["constructor"]: typeof HostRestartRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "host" as const;
	static permission = "core.host.restart" as const;
}

export class HostUpdateRequest {
	declare ["constructor"]: typeof HostUpdateRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "host" as const;
	static permission = "core.host.update" as const;
}

export class HostConfigGetRequest {
	declare ["constructor"]: typeof HostConfigGetRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "host" as const;
	static permission = "core.host.get_config" as const;
	static Response = plainJson(HostConfig.jsonSchema);
}

export class HostConfigSetRequest {
	declare ["constructor"]: typeof HostConfigSetRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "host" as const;
	static permission = "core.host.update_config" as const;

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

export class HostConfigSetFieldRequest {
	declare ["constructor"]: typeof HostConfigSetFieldRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "host" as const;
	static permission = "core.host.update_config" as const;

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

export class HostConfigSetPropRequest {
	declare ["constructor"]: typeof HostConfigSetPropRequest;
	static type = "request" as const;
	static src = ["control", "controller"] as const;
	static dst = "host" as const;
	static permission = "core.host.update_config" as const;

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

export class HostListRequest {
	declare ["constructor"]: typeof HostListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.host.list" as const;
	static Response = jsonArray(HostDetails);
}

export class HostInfoUpdate {
	name: string;
	publicAddress: string;

	constructor(
		name: string,
		publicAddress: string,
	) {
		this.name = name;
		this.publicAddress = publicAddress;
	}

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"publicAddress": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.name,
			json.publicAddress,
		);
	}
}

export class HostInfoUpdateEvent {
	declare ["constructor"]: typeof HostInfoUpdateEvent;
	static type = "event" as const;
	static src = "host" as const;
	static dst = "controller" as const;

	update: HostInfoUpdate;

	constructor(
		update: HostInfoUpdate,
	) {
		this.update = update;
	}

	static jsonSchema = Type.Object({
		"update": HostInfoUpdate.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(HostInfoUpdate.fromJSON(json.update));
	}
}

export class HostUpdatesEvent {
	declare ["constructor"]: typeof HostUpdatesEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.host.subscribe" as const;

	updates: HostDetails[];

	constructor(
		updates: HostDetails[],
	) {
		this.updates = updates;
	}

	static jsonSchema = Type.Object({
		"updates": Type.Array(HostDetails.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates.map(update => HostDetails.fromJSON(update)));
	}
}

export class HostMetricsRequest {
	declare ["constructor"]: typeof HostMetricsRequest;
	static type = "request" as const;
	static src = "controller" as const;
	static dst = "host" as const;
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

export class ControllerConnectionEvent {
	declare ["constructor"]: typeof ControllerConnectionEvent;
	static type = "event" as const;
	static src = "host" as const;
	static dst = "instance" as const;

	event: "connect" | "drop" | "resume" | "close";

	constructor(
		event: "connect" | "drop" | "resume" | "close",
	) {
		this.event = event;
	}

	static jsonSchema = Type.Object({
		"event": StringEnum(["connect", "drop", "resume", "close"]),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.event);
	}
}

export class PrepareControllerDisconnectRequest {
	declare ["constructor"]: typeof PrepareControllerDisconnectRequest;
	static type = "request" as const;
	static src = "host" as const;
	static dst = "instance" as const;
}

export class SyncUserListsEvent {
	declare ["constructor"]: typeof SyncUserListsEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "host" as const;

	adminlist: Set<string>;
	banlist: Map<string, string>;
	whitelist: Set<string>;

	constructor(
		adminlist: Set<string>,
		banlist: Map<string, string>,
		whitelist: Set<string>,
	) {
		this.adminlist = adminlist;
		this.banlist = banlist;
		this.whitelist = whitelist;
	}

	static jsonSchema = Type.Object({
		"adminlist": Type.Array(Type.String()),
		"banlist": Type.Array(
			Type.Tuple([Type.String(), Type.String()])
		),
		"whitelist": Type.Array(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(new Set(json.adminlist), new Map(json.banlist), new Set(json.whitelist));
	}

	toJSON() {
		return {
			adminlist: [...this.adminlist],
			banlist: [...this.banlist],
			whitelist: [...this.whitelist],
		};
	}
}

export class HostRevokeTokensRequest {
	declare["constructor"]: typeof HostRevokeTokensRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.host.revoke_token" as const;

	hostId: number;

	constructor(
		hostId: number,
	) {
		this.hostId = hostId;
	}

	static jsonSchema = Type.Object({
		"hostId": Type.Number(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.hostId);
	}
}
