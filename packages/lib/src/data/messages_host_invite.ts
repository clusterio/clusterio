import { Type, Static } from "@sinclair/typebox";
import { jsonArray, plainJson } from "./composites.js";
import HostInvite from "./HostInvite.js";

export class HostInviteListRequest {
	declare ["constructor"]: typeof HostInviteListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.host.invite.list" as const;
	static Response = jsonArray(HostInvite);
}

export class HostInviteUpdatesEvent {
	declare ["constructor"]: typeof HostInviteUpdatesEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.host.invite.subscribe" as const;

	constructor(
		public updates: HostInvite[],
	) { }

	static jsonSchema = Type.Object({
		"updates": Type.Array(HostInvite.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates.map(update => HostInvite.fromJSON(update)));
	}
}

/**
 * Create a host invite. Null limits mean the invite never expires or has
 * unlimited uses.
 */
export class HostInviteCreateRequest {
	declare ["constructor"]: typeof HostInviteCreateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.host.invite.create" as const;

	constructor(
		public expiresAtMs: number | null,
		public maxUses: number | null,
	) { }

	static jsonSchema = Type.Object({
		"expiresAtMs": Type.Union([Type.Number(), Type.Null()]),
		"maxUses": Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.expiresAtMs, json.maxUses);
	}

	static Response = plainJson(Type.Object({
		"invite": HostInvite.jsonSchema,
		/** Invite URL based on the public URL of the controller. */
		"url": Type.String(),
	}));
}

/**
 * Change the limits of a host invite or pause it. Undefined leaves a value
 * unchanged, null removes a limit.
 */
export class HostInviteUpdateRequest {
	declare ["constructor"]: typeof HostInviteUpdateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.host.invite.update" as const;

	constructor(
		public id: number,
		public expiresAtMs?: number | null,
		public maxUses?: number | null,
		public paused?: boolean,
	) { }

	static jsonSchema = Type.Object({
		"id": Type.Integer(),
		"expiresAtMs": Type.Optional(Type.Union([Type.Number(), Type.Null()])),
		"maxUses": Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
		"paused": Type.Optional(Type.Boolean()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.id, json.expiresAtMs, json.maxUses, json.paused);
	}
}

export class HostInviteRevokeRequest {
	declare ["constructor"]: typeof HostInviteRevokeRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.host.invite.revoke" as const;

	constructor(
		public id: number,
	) { }

	static jsonSchema = Type.Object({
		"id": Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.id);
	}
}
