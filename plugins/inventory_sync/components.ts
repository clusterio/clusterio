import type * as lib from "@clusterio/lib";
import type { IpcPlayerData } from "./messages.js";

/** Parts of the player data an instance can choose to sync, and the fields of the player data holding them. */
export const components = {
	controller: ["controller", "ticks_to_respawn", "cheat_mode"],
	force: ["force"],
	appearance: ["color", "chat_color", "tag"],
	inventories: ["character", "inventories", "crafting_queue"],
	logistics: ["personal_logistic_slots"],
	quick_bar: ["quick_bar", "hotbar"],
	settings: ["flashlight", "shortcuts", "game_view_settings"],
	recipe_notifications: ["recipe_notifications"],
} as const;

export type Component = keyof typeof components;

// Fields only a player with a character has
const characterFields = ["character", "crafting_queue", "personal_logistic_slots"] as const;

/**
 * Components synced on an instance.
 *
 * The controller is only synced together with the inventories, as
 * switching controller can destroy the character holding them.
 */
export function enabledComponents(config: lib.InstanceConfig) {
	const enabled = new Set<Component>();
	for (const component of Object.keys(components) as Component[]) {
		if (config.get(`inventory_sync.sync_${component}`)) {
			enabled.add(component);
		}
	}
	if (!enabled.has("inventories")) {
		enabled.delete("controller");
	}
	return enabled;
}

/** Remove the fields of components which are not synced. */
export function stripPlayerData(playerData: IpcPlayerData, enabled: Set<Component>) {
	const fields = playerData as Record<string, unknown>;
	for (const [component, keys] of Object.entries(components)) {
		if (!enabled.has(component as Component)) {
			for (const key of keys) {
				delete fields[key];
			}
		}
	}
	return playerData;
}

/**
 * Combine data uploaded by an instance with the stored data.
 *
 * Components the instance does not sync keep the stored fields. Without
 * the controller synced the god and ghost inventories are left as the
 * synced controller had them, and character fields are only taken from a
 * player which has a character.
 */
export function mergePlayerData(stored: IpcPlayerData | undefined, uploaded: IpcPlayerData, enabled: Set<Component>) {
	const merged: Record<string, unknown> = { ...uploaded };
	function keep(keys: readonly string[]) {
		for (const key of keys) {
			const value = (stored as Record<string, unknown> | undefined)?.[key];
			if (value !== undefined) {
				merged[key] = value;
			} else {
				delete merged[key];
			}
		}
	}

	for (const [component, keys] of Object.entries(components)) {
		if (!enabled.has(component as Component)) {
			keep(keys);
		}
	}
	if (!enabled.has("controller")) {
		keep(["inventories"]);
		if (!uploaded.character) {
			keep(characterFields);
		}
	}
	return merged as IpcPlayerData;
}
