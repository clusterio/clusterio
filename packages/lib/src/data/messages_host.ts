import { Type, Static } from "@sinclair/typebox";
import { jsonArray, StringEnum } from "./composites";
import { CollectorResultSerialized } from "../prometheus";

export class HostDetails {
	constructor(
		public agent: string,
		public version: string,
		public name: string,
		public id: number,
		public connected: boolean,
		public publicAddress?: string,
		public tokenValidAfter?: number,
	) { }

	static jsonSchema = Type.Object({
		"agent": Type.String(),
		"version": Type.String(),
		"name": Type.String(),
		"id": Type.Integer(),
		"connected": Type.Boolean(),
		"publicAddress": Type.Optional(Type.String()),
		"tokenValidAfter": Type.Optional(Type.Number()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.agent,
			json.version,
			json.name,
			json.id,
			json.connected,
			json.publicAddress,
			json.tokenValidAfter,
		);
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

export class HostUpdateEvent {
	declare ["constructor"]: typeof HostUpdateEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.host.subscribe" as const;

	constructor(
		public update: HostDetails,
	) { }

	static jsonSchema = Type.Object({
		"update": HostDetails.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(HostDetails.fromJSON(json.update));
	}

	get subscriptionChannel() {
		return this.update.id;
	}
}

export class HostMetricsRequest {
	declare ["constructor"]: typeof HostMetricsRequest;
	static type = "request" as const;
	static src = "controller" as const;
	static dst = "host" as const;
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

export class ControllerConnectionEvent {
	declare ["constructor"]: typeof ControllerConnectionEvent;
	static type = "event" as const;
	static src = "host" as const;
	static dst = "instance" as const;

	constructor(
		public event: "connect" | "drop" | "resume" | "close",
	) { }

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

	constructor(
		public adminlist: Set<string>,
		public banlist: Map<string, string>,
		public whitelist: Set<string>,
	) { }

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

	constructor(
		public hostId: number,
	) { }

	static jsonSchema = Type.Object({
		"hostId": Type.Number(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.hostId);
	}
}
