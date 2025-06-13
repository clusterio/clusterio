import { Static, Type } from "@sinclair/typebox";

import {
	IControllerUser, PermissionError, PlayerStats,
	Role, SubscribableDatastore, User, permissions,
} from "@clusterio/lib";

export default class ControllerUser extends User implements IControllerUser {
	constructor(
		private _controllerRoles: SubscribableDatastore<Role>,
		/** Unix time in seconds the user token must be issued after to be valid.  */
		public tokenValidAfter = 0,
		...args: ConstructorParameters<typeof User>
	) {
		super(...args);
	}

	static jsonSchema = Type.Object({
		...User.jsonSchema.properties,
		token_valid_after: Type.Optional(Type.Number()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>, controllerRoles: SubscribableDatastore<Role>) {
		const roleIds = new Set<number>(json.roles ?? []);
		const instanceStats = new Map(
			(json.instance_stats ?? []).map(
				([id, stats]) => [id, PlayerStats.fromJSON(stats)]
			)
		);
		const playerStats = User._calculatePlayerStats(instanceStats);
		return new this(
			controllerRoles,
			json.token_valid_after,
			json.name,
			roleIds,
			new Set(json.instances),
			json.is_admin,
			json.is_banned,
			json.is_whitelisted,
			json.ban_reason,
			json.updated_at_ms,
			json.is_deleted,
			playerStats,
			instanceStats,
		);
	}

	toJSON(controller?: boolean): Static<typeof ControllerUser.jsonSchema> {
		if (!controller) {
			return super.toJSON();
		}

		const json: Static<typeof ControllerUser.jsonSchema> = super.toJSON();
		if (this.tokenValidAfter) {
			json.token_valid_after = this.tokenValidAfter;
		}

		return json;
	}

	get roles(): ReadonlySet<Readonly<Role>> {
		return new Set([...this.roleIds].map(
			id => this._controllerRoles.get(id)
		).filter(
			(r): r is Role => Boolean(r)
		));
	}

	/**
	 * Invalidate current tokens for the user
	 *
	 * Sets the tokenValidAfter property to the current time, which causes
	 * all currently issued tokens for the user to become invalid.
	 */
	invalidateToken() {
		this.tokenValidAfter = Math.floor(Date.now() / 1000);
	}

	checkPermission(permission: string) {
		if (!permissions.has(permission)) {
			throw new Error(`permission ${permission} does not exist`);
		}

		for (let roleId of this.roleIds) {
			let role = this._controllerRoles.get(roleId);
			if (!role) {
				continue;
			}
			if (role.permissions.has("core.admin") || role.permissions.has(permission)) {
				return;
			}
		}

		throw new PermissionError("Permission denied");
	}
}
