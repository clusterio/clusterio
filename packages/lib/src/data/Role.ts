import { Static, Type } from "@sinclair/typebox";
import { permissions as globalPermissions } from "../permissions";

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

	constructor(
		public id: number,
		public name: string,
		public description: string,
		public permissions = new Set<string>(),
		public updatedAtMs = 0,
		public isDeleted = false,
	) { }

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
