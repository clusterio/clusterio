import { Type, Static } from "@sinclair/typebox";
import { JsonNumber, jsonArray } from "./composites";
import Permission from "./Permission";
import Role from "./Role";

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

export class RoleUpdatesEvent {
	declare ["constructor"]: typeof RoleUpdatesEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.role.subscribe" as const;

	constructor(
		public updates: Role[],
	) { }

	static jsonSchema = Type.Object({
		"updates": Type.Array(Role.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates.map(update => Role.fromJSON(update)));
	}
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
