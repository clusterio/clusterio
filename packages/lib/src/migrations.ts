/**
 * Helpers for plugin migrations
 * @module lib/migrations
 */
import type { Static } from "@sinclair/typebox";
import type { ConfigSchema } from "./config/classes.js";
import type Role from "./data/Role.js";

type SerializedRole = Static<typeof Role.jsonSchema>;

/**
 * Rename a field in a serialized config
 *
 * The value is moved if the old field exists and the new one doesn't. The
 * old field is removed either way.
 *
 * @param config - Serialized config to update.
 * @param from - Current name of the field.
 * @param to - New name of the field.
 * @returns The config passed in.
 */
export function renameConfigField(config: ConfigSchema, from: string, to: string) {
	if (Object.hasOwn(config, from)) {
		if (!Object.hasOwn(config, to)) {
			config[to] = config[from];
		}
		delete config[from];
	}
	return config;
}

/**
 * Rename all fields starting with a prefix in a serialized config
 *
 * @example
 * lib.renameConfigPrefix(config, "inventory_sync.", "player_sync.");
 *
 * @param config - Serialized config to update.
 * @param from - Current prefix of the fields.
 * @param to - New prefix of the fields.
 * @returns The config passed in.
 */
export function renameConfigPrefix(config: ConfigSchema, from: string, to: string) {
	for (const name of Object.keys(config)) {
		if (name.startsWith(from)) {
			renameConfigField(config, name, to + name.slice(from.length));
		}
	}
	return config;
}

/**
 * Rename a permission in a serialized role
 *
 * @param role - Serialized role to update.
 * @param from - Current name of the permission.
 * @param to - New name of the permission.
 * @returns The role passed in.
 */
export function renamePermission(role: SerializedRole, from: string, to: string) {
	return renamePermissionsWith(role, name => (name === from ? to : name));
}

/**
 * Rename all permissions starting with a prefix in a serialized role
 *
 * @param role - Serialized role to update.
 * @param from - Current prefix of the permissions.
 * @param to - New prefix of the permissions.
 * @returns The role passed in.
 */
export function renamePermissionPrefix(role: SerializedRole, from: string, to: string) {
	return renamePermissionsWith(role, name => (name.startsWith(from) ? to + name.slice(from.length) : name));
}

function renamePermissionsWith(role: SerializedRole, rename: (name: string) => string) {
	role.permissions = [...new Set(role.permissions.map(rename))];
	return role;
}
