import type * as lib from "@clusterio/lib";
import type { IpcPlayerData } from "./messages.js";

/** Parts of the player data an instance can choose to sync, and the fields of the player data holding them. */
export const components = {
	controller: ["controller", "ticks_to_respawn", "cheat_mode"],
	force: ["force"],
	appearance: ["color", "chat_color", "tag"],
	// inventories holds the god inventory and the hidden ghost inventory
	inventories: ["character", "crafting_queue", "inventories"],
	logistics: ["personal_logistic_slots"],
	quick_bar: ["quick_bar", "hotbar"],
	settings: ["flashlight", "shortcuts", "game_view_settings"],
	recipe_notifications: ["recipe_notifications"],
} as const;

export type Component = keyof typeof components;

function componentSet(isEnabled: (component: Component) => boolean) {
	return new Set((Object.keys(components) as Component[]).filter(isEnabled));
}

/** Components synced on an instance. */
export function enabledComponents(config: lib.InstanceConfig) {
	return componentSet(component => Boolean(config.get(`inventory_sync.sync_${component}`)));
}

/**
 * Components an upload was serialized with, all of them when not given.
 *
 * Lua may encode an empty table as an array, which reads as no components.
 */
export function uploadedComponents(uploaded: Record<string, boolean> | unknown[] | undefined) {
	if (uploaded === undefined) {
		return componentSet(() => true);
	}
	return componentSet(component => !Array.isArray(uploaded) && uploaded[component] === true);
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
 * Components the upload was not serialized with keep the stored fields.
 * Logistic requests are kept when the player has nowhere to hold them.
 */
export function mergePlayerData(stored: IpcPlayerData | undefined, uploaded: IpcPlayerData) {
	const { components: uploadComponents, ...merged } = uploaded as IpcPlayerData & Record<string, unknown>;
	const enabled = uploadedComponents(uploadComponents);
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
	if (!uploaded.character && !uploaded.personal_logistic_slots) {
		keep(["personal_logistic_slots"]);
	}
	return merged as IpcPlayerData;
}
