"use strict";
const PlayerStats = require("../PlayerStats");
const { jsonArray, JsonNumber } = require("./composites");

/* @memberof module:lib/data */
class RawPermission { // TODO refactor into lib/user.Permission
	/** @type {string} */
	name;
	/** @type {string} */
	title;
	/** @type {string} */
	description;

	constructor(name, title, description) {
		this.name = name;
		this.title = title;
		this.description = description;
	}

	static jsonSchema = {
		required: ["name", "title", "description"],
		properties: {
			name: { type: "string" },
			title: { type: "string" },
			description: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.title, json.description);
	}
}

/* @memberof module:lib/data */
class PermissionListRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.permission.list";
	static Response = jsonArray(RawPermission);
}

class RawRole { // TODO refactor into lib/user.Role
	/** @type {number} */
	id;
	/** @type {string} */
	name;
	/** @type {string} */
	description;
	/** @type {Array<string>} */
	permissions;

	constructor(id, name, description, permissions) {
		this.id = id;
		this.name = name;
		this.description = description;
		this.permissions = permissions;
	}

	static jsonSchema = {
		type: "object",
		required: ["id", "name", "description", "permissions"],
		properties: {
			id: { type: "integer" },
			name: { type: "string" },
			description: { type: "string" },
			permissions: {
				type: "array",
				items: { type: "string" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.id, json.name, json.description, json.permissions);
	}
}

/* @memberof module:lib/data */
class RoleListRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.role.list";
	static Response = jsonArray(RawRole);
}

/* @memberof module:lib/data */
class RoleCreateRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.role.create";

	/** @type {string} */
	name;
	/** @type {string} */
	description;
	/** @type {Array<string>} */
	permissions;

	constructor(name, description, permissions) {
		this.name = name;
		this.description = description;
		this.permissions = permissions;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "description", "permissions"],
		properties: {
			name: { type: "string" },
			description: { type: "string" },
			permissions: {
				type: "array",
				items: { type: "string" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.description, json.permissions);
	}

	static Response = JsonNumber;
}

/* @memberof module:lib/data */
class RoleUpdateRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.role.update";

	/** @type {number} */
	id;
	/** @type {string} */
	name;
	/** @type {string} */
	description;
	/** @type {Array<string>} */
	permissions;

	constructor(id, name, description, permissions) {
		this.id = id;
		this.name = name;
		this.description = description;
		this.permissions = permissions;
	}

	static jsonSchema = {
		type: "object",
		required: ["id", "name", "description", "permissions"],
		properties: {
			id: { type: "integer" },
			name: { type: "string" },
			description: { type: "string" },
			permissions: {
				type: "array",
				items: { type: "string" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.id, json.name, json.description, json.permissions);
	}
}

/* @memberof module:lib/data */
class RoleGrantDefaultPermissionsRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.role.update";

	/** @type {number} */
	id;

	constructor(id) {
		this.id = id;
	}

	static jsonSchema = {
		type: "object",
		required: ["id"],
		properties: {
			id: { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.id);
	}
}

/* @memberof module:lib/data */
class RoleDeleteRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.role.delete";

	/** @type {number} */
	id;

	constructor(id) {
		this.id = id;
	}

	static jsonSchema = {
		type: "object",
		required: ["id"],
		properties: {
			id: { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.id);
	}
}

/* @memberof module:lib/data */
class RawUser { // TODO refactor into lib/user.User
	/** @type {string} */
	name;
	/** @type {Array<number>} */
	roles;
	/** @type {Array<number>} */
	instances;
	/** @type {boolean|undefined} */
	isAdmin;
	/** @type {boolean|undefined} */
	isBanned;
	/** @type {boolean|undefined} */
	isWhitelisted;
	/** @type {string|undefined} */
	banReason;
	/** @type {boolean|undefined} */
	isDeleted;
	/** @type {module:lib/PlayerStats} */
	playerStats;
	/** @type {Map<number, module:lib/PlayerStats>|undefined} */
	instanceStats;

	constructor(
		name, roles, instances, isAdmin, isBanned, isWhitelisted, banReason,
		isDeleted, playerStats, instanceStats
	) {
		this.name = name;
		this.roles = roles;
		this.instances = instances;
		if (isAdmin !== undefined) { this.isAdmin = isAdmin; }
		if (isBanned !== undefined) { this.isBanned = isBanned; }
		if (isWhitelisted !== undefined) { this.isWhitelisted = isWhitelisted; }
		if (banReason !== undefined) { this.banReason = banReason; }
		if (isDeleted !== undefined) { this.isDeleted = isDeleted; }
		if (playerStats !== undefined) { this.playerStats = playerStats; }
		if (instanceStats !== undefined) { this.instanceStats = instanceStats; }
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "roles", "instances"],
		properties: {
			name: { type: "string" },
			roles: { type: "array", items: { type: "integer" } },
			isAdmin: { type: "boolean" },
			isBanned: { type: "boolean" },
			isWhitelisted: { type: "boolean" },
			banReason: { type: "string" },
			instances: { type: "array", items: { type: "integer" } },
			isDeleted: { type: "boolean" },
			playerStats: PlayerStats.jsonSchema,
			instanceStats: {
				type: "array",
				items: {
					type: "array",
					items: [{ type: "integer" }, PlayerStats.jsonSchema],
				},
			},
		},
	};

	static fromJSON(json) {
		let playerStats;
		if (json.playerStats) {
			playerStats = PlayerStats.fromJSON(json.playerStats);
		}
		let instanceStats;
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
}

/* @memberof module:lib/data */
class UserGetRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.user.get";

	/** @type {string} */
	name;

	constructor(name) {
		this.name = name;
	}

	static jsonSchema = {
		type: "object",
		required: ["name"],
		properties: {
			name: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.name);
	}

	static Response = RawUser;
}

/* @memberof module:lib/data */
class UserListRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.user.list";
	static Response = jsonArray(RawUser);
}

/* @memberof module:lib/data */
class UserSetSubscriptionsRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.user.subscribe";

	/** @type {boolean} */
	all;
	/** @type {Array<string>} */
	names;

	constructor(all, names) {
		this.all = all;
		this.names = names;
	}

	static jsonSchema = {
		type: "object",
		required: ["all", "names"],
		properties: {
			all: { type: "boolean" },
			names: {
				type: "array",
				items: { type: "string" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.all, json.names);
	}
}

/* @memberof module:lib/data */
class UserCreateRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.user.create";

	/** @type {string} */
	name;

	constructor(name) {
		this.name = name;
	}

	static jsonSchema = {
		type: "object",
		required: ["name"],
		properties: {
			name: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.name);
	}
}

/* @memberof module:lib/data */
class UserRevokeTokenRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.user.revoke_token";

	/** @type {string} */
	name;

	constructor(name) {
		this.name = name;
	}

	static jsonSchema = {
		type: "object",
		required: ["name"],
		properties: {
			name: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.name);
	}
}

/* @memberof module:lib/data */
class UserUpdateRolesRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.user.update_roles";

	/** @type {string} */
	name;
	/** @type {Array<number>} */
	roles;

	constructor(name, roles) {
		this.name = name;
		this.roles = roles;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "roles"],
		properties: {
			name: { type: "string" },
			roles: {
				type: "array",
				items: { type: "integer" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.roles);
	}
}

/* @memberof module:lib/data */
class UserSetAdminRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.user.set_admin";

	/** @type {string} */
	name;
	/** @type {boolean} */
	create;
	/** @type {boolean} */
	admin;

	constructor(name, create, admin) {
		this.name = name;
		this.create = create;
		this.admin = admin;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "create", "admin"],
		properties: {
			name: { type: "string" },
			create: { type: "boolean" },
			admin: { type: "boolean" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.create, json.admin);
	}
}

/* @memberof module:lib/data */
class UserSetWhitelistedRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.user.set_whitelisted";

	/** @type {string} */
	name;
	/** @type {boolean} */
	create;
	/** @type {boolean} */
	whitelisted;

	constructor(name, create, whitelisted) {
		this.name = name;
		this.create = create;
		this.whitelisted = whitelisted;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "create", "whitelisted"],
		properties: {
			name: { type: "string" },
			create: { type: "boolean" },
			whitelisted: { type: "boolean" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.create, json.whitelisted);
	}
}

/* @memberof module:lib/data */
class UserSetBannedRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.user.set_banned";

	/** @type {string} */
	name;
	/** @type {boolean} */
	create;
	/** @type {boolean} */
	banned;
	/** @type {string} */
	reason;

	constructor(name, create, banned, reason) {
		this.name = name;
		this.create = create;
		this.banned = banned;
		this.reason = reason;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "create", "banned", "reason"],
		properties: {
			name: { type: "string" },
			create: { type: "boolean" },
			banned: { type: "boolean" },
			reason: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.create, json.banned, json.reason);
	}
}

/* @memberof module:lib/data */
class UserDeleteRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.user.delete";

	/** @type {string} */
	name;

	constructor(name) {
		this.name = name;
	}

	static jsonSchema = {
		type: "object",
		required: ["name"],
		properties: {
			name: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.name);
	}
}


/* @memberof module:lib/data */
class AccountUpdateEvent {
	static type = "event";
	static src = "controller";
	static dst = "control";

	/** @type {Array<object>|undefined} */
	roles;

	constructor(roles) {
		if (roles) { this.roles = roles; }
	}

	static jsonSchema = {
		type: "object",
		properties: {
			roles: {
				type: "array",
				items: {
					type: "object",
					required: ["name", "id", "permissions"],
					properties: {
						name: { type: "string" },
						id: { type: "integer" },
						permissions: {
							type: "array",
							items: { type: "string" },
						},
					},
				},
			},
		},
	};

	static fromJSON(json) {
		return new this(json.roles);
	}
}

/* @memberof module:lib/data */
class UserUpdateEvent {
	static type = "event";
	static src = "controller";
	static dst = "control";

	/** @type {module:lib/data.RawUser} */
	user;

	constructor(user) {
		this.user = user;
	}

	static jsonSchema = {
		type: "object",
		required: ["user"],
		properties: {
			user: RawUser.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(RawUser.fromJSON(json.user));
	}
}

module.exports = {
	RawPermission,
	PermissionListRequest,
	RawRole,
	RoleListRequest,
	RoleCreateRequest,
	RoleUpdateRequest,
	RoleGrantDefaultPermissionsRequest,
	RoleDeleteRequest,
	RawUser,
	UserGetRequest,
	UserListRequest,
	UserSetSubscriptionsRequest,
	UserCreateRequest,
	UserRevokeTokenRequest,
	UserUpdateRolesRequest,
	UserSetAdminRequest,
	UserSetWhitelistedRequest,
	UserSetBannedRequest,
	UserDeleteRequest,
	AccountUpdateEvent,
	UserUpdateEvent,
};
