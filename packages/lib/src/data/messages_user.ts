import { Type, Static } from "@sinclair/typebox";
import PlayerStats from "../PlayerStats";
import { JsonNumber, jsonArray } from "./composites";
import { AccountRole } from "../plugin";

export class RawPermission { // TODO refactor into lib/user.Permission
	constructor(
		public name: string,
		public title: string,
		public description: string,
	) { }

	static jsonSchema = Type.Object({
		name: Type.String(),
		title: Type.String(),
		description: Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.title, json.description);
	}
}

export class PermissionListRequest {
	declare ["constructor"]: typeof PermissionListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.permission.list" as const;
	static Response = jsonArray(RawPermission);
}

export class RawRole { // TODO refactor into lib/user.Role
	constructor(
		public id: number,
		public name: string,
		public description: string,
		public permissions: string[],
	) { }

	static jsonSchema = Type.Object({
		id: Type.Integer(),
		name: Type.String(),
		description: Type.String(),
		permissions: Type.Array(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.id, json.name, json.description, json.permissions);
	}
}

export class RoleListRequest {
	declare ["constructor"]: typeof RoleListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.role.list" as const;
	static Response = jsonArray(RawRole);
}

export class RoleCreateRequest {
	declare ["constructor"]: typeof RoleCreateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.role.create" as const;

	constructor(
		public name: string,
		public description: string,
		public permissions: string[],
	) { }

	static jsonSchema = Type.Object({
		name: Type.String(),
		description: Type.String(),
		permissions: Type.Array(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.description, json.permissions);
	}

	static Response = JsonNumber;
}

export class RoleUpdateRequest {
	declare ["constructor"]: typeof RoleUpdateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.role.update" as const;

	constructor(
		public id: number,
		public name: string,
		public description: string,
		public permissions: string[],
	) { }

	static jsonSchema = Type.Object({
		id: Type.Integer(),
		name: Type.String(),
		description: Type.String(),
		permissions: Type.Array(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.id, json.name, json.description, json.permissions);
	}
}

export class RoleGrantDefaultPermissionsRequest {
	declare ["constructor"]: typeof RoleGrantDefaultPermissionsRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.role.update" as const;

	constructor(
		public id: number,
	) { }

	static jsonSchema = Type.Object({
		id: Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.id);
	}
}

export class RoleDeleteRequest {
	declare ["constructor"]: typeof RoleDeleteRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.role.delete" as const;

	constructor(
		public id: number,
	) { }

	static jsonSchema = Type.Object({
		id: Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.id);
	}
}

export class RawUser { // TODO refactor into lib/user.User
	constructor(
		public name: string,
		public roles: number[],
		public instances: number[],
		public isAdmin?: boolean,
		public isBanned?: boolean,
		public isWhitelisted?: boolean,
		public banReason?: string,
		public isDeleted?: boolean,
		public playerStats?: PlayerStats,
		public instanceStats?: Map<number, PlayerStats>,
	) { }

	static jsonSchema = Type.Object({
		name: Type.String(),
		roles: Type.Array(Type.Integer()),
		instances: Type.Array(Type.Integer()),
		isAdmin: Type.Optional(Type.Boolean()),
		isBanned: Type.Optional(Type.Boolean()),
		isWhitelisted: Type.Optional(Type.Boolean()),
		banReason: Type.Optional(Type.String()),
		isDeleted: Type.Optional(Type.Boolean()),
		playerStats: Type.Optional(PlayerStats.jsonSchema),
		instanceStats: Type.Optional(
			Type.Array(
				Type.Tuple([Type.Integer(), PlayerStats.jsonSchema]),
			)
		),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		let playerStats: PlayerStats | undefined;
		if (json.playerStats) {
			playerStats = PlayerStats.fromJSON(json.playerStats);
		}
		let instanceStats: Map<number, PlayerStats> | undefined;
		if (json.instanceStats) {
			instanceStats = new Map(
				json.instanceStats.map(([id, stats]) => [id, PlayerStats.fromJSON(stats)])
			);
		}
		return new this(
			json.name, json.roles, json.instances, json.isAdmin, json.isBanned, json.isWhitelisted, json.banReason,
			json.isDeleted, playerStats, instanceStats
		);
	}

	toJSON() {
		const json: Static<typeof RawUser.jsonSchema> = {
			name: this.name,
			roles: this.roles,
			instances: this.instances,
			isAdmin: this.isAdmin,
			isBanned: this.isBanned,
			isWhitelisted: this.isWhitelisted,
			banReason: this.banReason,
			isDeleted: this.isDeleted,
		};
		if (this.playerStats) {
			json.playerStats = this.playerStats.toJSON()
		}
		if (this.instanceStats) {
			json.instanceStats = [...this.instanceStats].map(([k, v]) => [k, v.toJSON()]);
		}
		return json;
	}
}

export class UserGetRequest {
	declare ["constructor"]: typeof UserGetRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.user.get" as const;

	constructor(
		public name: string,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name);
	}

	static Response = RawUser;
}

export class UserListRequest {
	declare ["constructor"]: typeof UserListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.user.list" as const;
	static Response = jsonArray(RawUser);
}

export class UserCreateRequest {
	declare ["constructor"]: typeof UserCreateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.user.create" as const;

	constructor(
		public name: string,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name);
	}
}

export class UserRevokeTokenRequest {
	declare ["constructor"]: typeof UserRevokeTokenRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.user.revoke_token" as const;

	constructor(
		public name: string,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name);
	}
}

export class UserUpdateRolesRequest {
	declare ["constructor"]: typeof UserUpdateRolesRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.user.update_roles" as const;

	constructor(
		public name: string,
		public roles: number[],
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"roles": Type.Array(Type.Integer()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.roles);
	}
}

export class UserSetAdminRequest {
	declare ["constructor"]: typeof UserSetAdminRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.user.set_admin" as const;

	constructor(
		public name: string,
		public create: boolean,
		public admin: boolean,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"create": Type.Boolean(),
		"admin": Type.Boolean(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.create, json.admin);
	}
}

export class UserSetWhitelistedRequest {
	declare ["constructor"]: typeof UserSetWhitelistedRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.user.set_whitelisted" as const;

	constructor(
		public name: string,
		public create: boolean,
		public whitelisted: boolean,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"create": Type.Boolean(),
		"whitelisted": Type.Boolean(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.create, json.whitelisted);
	}
}

export class UserSetBannedRequest {
	declare ["constructor"]: typeof UserSetBannedRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.user.set_banned" as const;

	constructor(
		public name: string,
		public create: boolean,
		public banned: boolean,
		public reason: string,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"create": Type.Boolean(),
		"banned": Type.Boolean(),
		"reason": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.create, json.banned, json.reason);
	}
}

export class UserDeleteRequest {
	declare ["constructor"]: typeof UserDeleteRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.user.delete" as const;

	constructor(
		public name: string,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name);
	}
}


export class AccountUpdateEvent {
	declare ["constructor"]: typeof AccountUpdateEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;

	constructor(
		public roles?: AccountRole[],
	) { }

	static jsonSchema = Type.Object({
		roles: Type.Array(
			Type.Object({
				name: Type.String(),
				id: Type.Integer(),
				permissions: Type.Array(Type.String()),
			}),
		),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.roles);
	}
}

export class UserUpdateEvent {
	declare ["constructor"]: typeof UserUpdateEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.user.subscribe" as const;

	constructor(
		public user: RawUser,
	) { }

	static jsonSchema = Type.Object({
		"user": RawUser.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(RawUser.fromJSON(json.user));
	}
}
