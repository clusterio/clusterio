import { Type, Static } from "@sinclair/typebox";
import Permission from "./Permission";
import Role from "./Role";
import User from "./User";
import { JsonNumber, jsonArray } from "./composites";

export class PermissionListRequest {
	declare ["constructor"]: typeof PermissionListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.permission.list" as const;
	static Response = jsonArray(Permission);
}

export class RoleListRequest {
	declare ["constructor"]: typeof RoleListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.role.list" as const;
	static Response = jsonArray(Role);
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

	static Response = User;
}

export class UserListRequest {
	declare ["constructor"]: typeof UserListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.user.list" as const;
	static Response = jsonArray(User);
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

export class UserUpdateEvent {
	declare ["constructor"]: typeof UserUpdateEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.user.subscribe" as const;

	constructor(
		public user: User,
	) { }

	static jsonSchema = Type.Object({
		"user": User.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(User.fromJSON(json.user));
	}

	get subscriptionChannel() {
		return this.user.name;
	}
}
