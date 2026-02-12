import { Type, Static } from "@sinclair/typebox";
import User, { IUserView } from "./User";
import { StringEnum, jsonArray, plainJson } from "./composites";
import { MessageRequest } from "./messages_core";

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

export class UserUpdatesEvent {
	declare ["constructor"]: typeof UserUpdatesEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.user.subscribe" as const;

	constructor(
		public updates: User[],
	) { }

	static jsonSchema = Type.Object({
		"updates": Type.Array(User.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates.map(update => User.fromJSON(update)));
	}
}

export class ClusterioUserExport {
	public export_version = "2.0.0-alpha.20"; // Only increment when jsonSchema changes

	static clusterioUserSchema = Type.Object({
		"username": Type.String(),
		"is_admin": Type.Optional(Type.Boolean()),
		"is_whitelisted": Type.Optional(Type.Boolean()),
		"is_banned": Type.Optional(Type.Boolean()),
		"ban_reason": Type.Optional(Type.String()),
	});

	static factorioUserSchema = Type.Union([
		Type.String(),
		Type.Object({
			"username": Type.String(),
			"reason": Type.String(),
		}),
	]);

	static jsonSchema = Type.Object({
		"export_version": Type.String(),
		"users": Type.Array(this.clusterioUserSchema),
	});

	constructor(
		public users: Static<typeof ClusterioUserExport.jsonSchema.properties.users>,
	) { }

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		const obj = new this(json.users);
		obj.export_version = json.export_version;
		return obj;
	}
}

export class UserBulkImportRequest {
	declare ["constructor"]: typeof UserBulkImportRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission(user: IUserView, message: MessageRequest) {
		if (typeof message.data === "object" && message.data !== null) {
			const data = message.data as Static<typeof UserBulkImportRequest.jsonSchema>;
			// Check if this is a restore or import request
			if (data.restore) {
				user.checkPermission("core.user.bulk_restore");
			} else {
				user.checkPermission("core.user.bulk_import");
			}
			// Check if they have the permission for that type
			switch (data.importType) {
				case "users":
					user.checkPermission("core.user.set_admin");
					user.checkPermission("core.user.set_banned");
					user.checkPermission("core.user.set_whitelisted");
					break;
				case "admins":
					user.checkPermission("core.user.set_admin");
					break;
				case "bans":
					user.checkPermission("core.user.set_banned");
					break;
				case "whitelist":
					user.checkPermission("core.user.set_whitelisted");
					break;
				default:
					// @ts-expect-error Unreachable
					throw new Error(`Unknown import / restore type: ${data.importType}`);
			}
		}
	}

	static Response = plainJson(Type.Union([
		Type.Array(ClusterioUserExport.factorioUserSchema),
		ClusterioUserExport.jsonSchema,
	]));

	constructor(
		public importType: "users" | "bans" | "admins" | "whitelist",
		public users: Static<typeof ClusterioUserExport.clusterioUserSchema>[]
			| Static<typeof ClusterioUserExport.factorioUserSchema>[],
		public restore?: boolean
	) { }

	static jsonSchema = Type.Union([
		Type.Object({
			"importType": StringEnum(["bans", "admins", "whitelist"]),
			"users": Type.Array(ClusterioUserExport.factorioUserSchema),
			"restore": Type.Optional(Type.Boolean()),
		}),
		Type.Object({
			"importType": Type.Literal("users"),
			"users": Type.Array(ClusterioUserExport.clusterioUserSchema),
			"restore": Type.Optional(Type.Boolean()),
		}),
	]);

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.importType, json.users, json.restore);
	}
}

export class UserBulkExportRequest {
	declare ["constructor"]: typeof UserBulkExportRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.user.bulk_export" as const;
	static Response = plainJson(Type.Union([
		Type.Array(ClusterioUserExport.factorioUserSchema),
		ClusterioUserExport.jsonSchema,
	]));

	constructor(
		public exportType: "users" | "bans" | "admins" | "whitelist",
	) { }

	static jsonSchema = Type.Object({
		"exportType": StringEnum(["users", "bans", "admins", "whitelist"]),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.exportType);
	}
}
