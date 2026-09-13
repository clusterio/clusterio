import { type Static, Type } from "@sinclair/typebox";
import { permissions as globalPermissions } from "../permissions.ts";

interface RoleCollection {
	get(id: number): Role;
	set(role: Role): void;
}

/**
 * Represents a collection of granted permissions
 */
export default class Role {
	static DefaultAdminRoleId = 0 as const;
	static DefaultPlayerRoleId = 1 as const;

	id: number;
	name: string;
	description: string;
	permissions: Set<string>;
	updatedAtMs: number;
	isDeleted: boolean;

	constructor(
		id: number,
		name: string,
		description: string,
		permissions = new Set<string>(),
		updatedAtMs = 0,
		isDeleted = false,
	) {
		this.id = id;
		this.name = name;
		this.description = description;
		this.permissions = permissions;
		this.updatedAtMs = updatedAtMs;
		this.isDeleted = isDeleted;
	}

	static jsonSchema = Type.Object({
		id: Type.Number(),
		name: Type.String(),
		description: Type.String(),
		permissions: Type.Array(Type.String()),
		updated_at_ms: Type.Optional(Type.Number()),
		is_deleted: Type.Optional(Type.Boolean()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.id,
			json.name,
			json.description,
			new Set(json.permissions),
			json.updated_at_ms,
			json.is_deleted,
		);
	}

	toJSON() {
		return {
			id: this.id,
			name: this.name,
			description: this.description,
			permissions: [...this.permissions],
			updated_at_ms: this.updatedAtMs,
			is_deleted: this.isDeleted,
		};
	}

	static ensureDefaultPlayerRole(roles: RoleCollection) {
		const playerRole = roles.get(this.DefaultPlayerRoleId)
			?? new this(this.DefaultPlayerRoleId, "Player", "Default player role.");
		playerRole.grantDefaultPermissions();
		roles.set(playerRole);
	}

	grantDefaultPermissions() {
		for (let permission of globalPermissions.values()) {
			if (permission.grantByDefault) {
				this.permissions.add(permission.name);
			}
		}
	}

	static ensureDefaultAdminRole(roles: RoleCollection) {
		const adminRole = roles.get(this.DefaultAdminRoleId)
			?? new this(this.DefaultAdminRoleId, "Cluster Admin", "Cluster wide administrator.");
		adminRole.grantAdminPermissions();
		roles.set(adminRole);
	}

	grantAdminPermissions() {
		this.permissions.add("core.admin");
	}
}
