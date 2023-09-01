import { Type, Static } from "@sinclair/typebox";
import { JsonString, StringEnum } from "./composites";
import { levels } from "../logging";
import { RawConfig } from "../config";

export class ControllerConfigGetRequest {
	declare ["constructor"]: typeof ControllerConfigGetRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.controller.get_config" as const;
	static Response = RawConfig;
}

export class ControllerConfigSetFieldRequest {
	declare ["constructor"]: typeof ControllerConfigSetFieldRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.controller.update_config" as const;

	constructor(
		public field: string,
		public value: string,
	) { }

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

	constructor(
		public field: string,
		public prop: string,
		public value?: unknown,
	) { }

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

	constructor(
		public hostId?: number,
	) { }

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

	constructor(
		public id: number | undefined,
		public name: string | undefined,
		public generateToken: boolean,
	) { }

	static jsonSchema = Type.Object({
		"id": Type.Optional(Type.Integer()),
		"name": Type.Optional(Type.String()),
		"generateToken": Type.Boolean(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.id, json.name, json.generateToken);
	}

	static Response = RawConfig;
}

export class LogSetSubscriptionsRequest {
	declare ["constructor"]: typeof LogSetSubscriptionsRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.log.follow" as const;

	constructor(
		public all?: boolean,
		public controller?: boolean,
		public hostIds?: number[],
		public instanceIds?: number[],
		public maxLevel?: keyof typeof levels,
	) { }

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

	constructor(
		public all: boolean,
		public controller: boolean,
		public hostIds: number[],
		public instanceIds: number[],
		public maxLevel: undefined | keyof typeof levels,
		public limit: number,
		public order: "asc" | "desc",
	) { }

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
		constructor(
			public log: object[],
		) { }

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

	constructor(
		public info: { level: string, message: string },
	) { }

	static jsonSchema = Type.Object({
		"info": Type.Object({
			"level": Type.String(),
			"message": Type.String(),
		}),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.info);
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

	constructor(
		public direction: string,
		public content: string,
	) { }

	static jsonSchema = Type.Object({
		"direction": Type.String(),
		"content": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.direction, json.content);
	}
}
