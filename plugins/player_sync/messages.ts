import { Type, Static, TSchema } from "@sinclair/typebox";
import { StringEnum, jsonArray } from "@clusterio/lib";

// .\module\serialize.lua:serialize.serialize_player()
export type IpcPlayerData = {
	generation: number,
	/**
	 * Bumped when the stored data is imported or deleted, invalidating copies held by instances.
	 * Instances from before epochs were added leave it out of uploads.
	 */
	epoch?: number,
	name: string,
	controller?: string,
	color?: number[],
	chat_color?: number[],
	tag?: string,
	force?: string,
	cheat_mode?: boolean,
	flashlight?: boolean,
	shortcuts?: Record<string, boolean>,
	game_view_settings?: Record<string, boolean>,
	ticks_to_respawn?: number,
	character?: any,
	inventories?: any,
	quick_bar?: any,
	hotbar?: Record<string, string>,
	personal_logistic_slots?: any,
	crafting_queue?: any,
	recipe_notifications?: string,
	// Components the upload was serialized with, all when missing
	components?: Record<string, boolean> | unknown[],
	destination_instance_id?: number, // set_destination's instance, on the leave upload only; not player data
}

// Marks tombstones in player_sync.json
const jsonReserved = { deleted: Type.Optional(Type.Never()) };
const jsonPlayerData = Type.Object({
	generation: Type.Integer({ minimum: 0 }),
	epoch: Type.Optional(Type.Integer({ minimum: 0 })),
	name: Type.String(),
	...jsonReserved,
});

// The parts of an import that module/serialize.lua relies on, item stacks are checked by the Lua deserializer
// An empty Lua table is encoded as an object
function jsonList<T extends TSchema>(item: T) {
	return Type.Union([Type.Array(item), Type.Object({}, { maxProperties: 0 })]);
}
// Item stack format of packages/host/modules/clusterio/serialize.lua, the nested parts are left to Lua
const jsonInventory = Type.Object({
	b: Type.Optional(Type.Integer({ minimum: 0 })),
	i: jsonList(Type.Object({
		s: Type.Optional(Type.Integer({ minimum: 1 })),
		r: Type.Optional(Type.Integer({ minimum: 0 })),
		f: Type.Optional(Type.Union([Type.String(), Type.Object({})])),
		e: Type.Optional(Type.String()),
		n: Type.Optional(Type.String()),
		c: Type.Optional(Type.Integer({ minimum: 1 })),
		q: Type.Optional(Type.String()),
		h: Type.Optional(Type.Number({ minimum: 0 })),
		p: Type.Optional(Type.Number({ minimum: 0 })),
		d: Type.Optional(Type.Number({ minimum: 0 })),
		a: Type.Optional(Type.Number({ minimum: 0 })),
	})),
});
const jsonInventories = Type.Record(Type.String(), jsonInventory);
const jsonColor = Type.Union([
	Type.Object({ r: Type.Number(), g: Type.Number(), b: Type.Number(), a: Type.Optional(Type.Number()) }),
	Type.Array(Type.Number(), { minItems: 3, maxItems: 4 }),
]);
// Missing stats are left as they are, the minimums are the ones Factorio enforces
const jsonCharacter = Type.Object({
	character_crafting_speed_modifier: Type.Optional(Type.Number({ minimum: -1 })),
	character_mining_speed_modifier: Type.Optional(Type.Number({ minimum: -1 })),
	character_additional_mining_categories: Type.Optional(jsonList(Type.String())),
	character_running_speed_modifier: Type.Optional(Type.Number({ minimum: -1 })),
	character_build_distance_bonus: Type.Optional(Type.Number({ minimum: 0 })),
	character_item_drop_distance_bonus: Type.Optional(Type.Number({ minimum: 0 })),
	character_reach_distance_bonus: Type.Optional(Type.Number({ minimum: 0 })),
	character_resource_reach_distance_bonus: Type.Optional(Type.Number({ minimum: 0 })),
	character_item_pickup_distance_bonus: Type.Optional(Type.Number({ minimum: 0 })),
	character_loot_pickup_distance_bonus: Type.Optional(Type.Number({ minimum: 0 })),
	character_inventory_slots_bonus: Type.Optional(Type.Integer({ minimum: 0 })),
	character_trash_slot_count_bonus: Type.Optional(Type.Integer({ minimum: 0 })),
	character_maximum_following_robot_count_bonus: Type.Optional(Type.Integer({ minimum: 0 })),
	character_health_bonus: Type.Optional(Type.Number({ minimum: 0 })),
	character_personal_logistic_requests_enabled: Type.Optional(Type.Boolean()),
	allow_dispatching_robots: Type.Optional(Type.Boolean()),
	inhibit_movement_bonus: Type.Optional(Type.Boolean()),
	inventories: Type.Optional(jsonInventories),
});
const jsonLogisticSlot = Type.Object({
	name: Type.String(),
	min: Type.Optional(Type.Integer({ minimum: 0 })),
	max: Type.Optional(Type.Integer({ minimum: 0 })),
});
const jsonComparator = StringEnum(["=", ">", "<", "≥", ">=", "≤", "<=", "≠", "!="]);
// Limits enforced by LuaLogisticSection.filters
const jsonLogisticFilter = Type.Object({
	value: Type.Optional(Type.Union([
		Type.String(),
		Type.Object({
			type: Type.Optional(StringEnum([
				"item", "fluid", "virtual", "entity", "recipe", "space-location", "asteroid-chunk", "quality",
			])),
			name: Type.String(),
			quality: Type.Optional(Type.String()),
			comparator: Type.Optional(jsonComparator),
		}),
	])),
	min: Type.Optional(Type.Integer({ minimum: -(2 ** 31), maximum: 2 ** 31 - 1 })),
	max: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 ** 32 - 1 })),
	minimum_delivery_count: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 ** 32 - 1 })),
	// Exported as null, the prototype does not convert to JSON
	import_from: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
const jsonPersonalLogisticSlots = Type.Union([
	Type.Object({
		enabled: Type.Boolean(),
		trash_not_requested: Type.Boolean(),
		sections: jsonList(Type.Object({
			group: Type.String(),
			active: Type.Boolean(),
			multiplier: Type.Number({ minimum: 0 }),
			filters: jsonList(jsonLogisticFilter),
		})),
	}),
	// From before 2.0, slot index to request
	Type.Record(Type.String({ pattern: "^[1-9][0-9]*$" }), jsonLogisticSlot, { additionalProperties: false }),
	Type.Array(jsonLogisticSlot),
]);
// QuickBarSlotEncoded in module/serialize.lua
const jsonQuickBarSlot = Type.Union([
	Type.String(),
	Type.Object({
		t: Type.Literal("f"),
		n: Type.String(),
		q: Type.Optional(Type.String()),
		c: Type.Optional(jsonComparator),
	}),
	Type.Object({
		t: Type.Literal("i"),
		n: Type.String(),
		s: Type.Integer({ minimum: 1 }),
		b: Type.Optional(jsonList(Type.Integer({ minimum: 1 }))),
	}),
	Type.Object({
		t: Type.Literal("r"),
		p: jsonList(Type.Integer({ minimum: 1 })),
		y: Type.String(),
		l: Type.Optional(Type.String()),
	}),
]);
const jsonCraftingQueue = Type.Object({
	crafting_queue: jsonList(Type.Object({ recipe: Type.String(), count: Type.Integer({ minimum: 1 }) })),
	crafting_queue_progress: Type.Number({ minimum: 0, maximum: 1 }),
	ingredients: jsonList(Type.Object({
		name: Type.String(),
		count: Type.Integer({ minimum: 1 }),
		quality: Type.Optional(Type.String()),
	})),
});
const jsonTable = Type.Union([Type.Array(Type.Unknown()), Type.Object({})]);
// Lua's JSON loses precision past this, generations from here on are not counted up
export const generationLimit = 2 ** 50;
const jsonImportedPlayerData = Type.Object({
	generation: Type.Integer({ minimum: 0 }),
	epoch: Type.Optional(Type.Integer({ minimum: 0 })),
	name: Type.String(),
	// Any physical controller, remote view is never stored and a cutscene needs waypoints to restore
	controller: Type.Optional(StringEnum(["character", "god", "editor", "spectator", "ghost"])),
	color: Type.Optional(jsonColor),
	chat_color: Type.Optional(jsonColor),
	tag: Type.Optional(Type.String()),
	force: Type.Optional(Type.String()),
	cheat_mode: Type.Optional(Type.Boolean()),
	flashlight: Type.Optional(Type.Boolean()),
	shortcuts: Type.Optional(Type.Record(Type.String(), Type.Boolean())),
	game_view_settings: Type.Optional(Type.Record(Type.String(), Type.Boolean())),
	ticks_to_respawn: Type.Optional(Type.Integer({ minimum: 0 })),
	character: Type.Optional(jsonCharacter),
	inventories: Type.Optional(jsonInventories),
	quick_bar: Type.Optional(Type.Record(Type.String(), jsonQuickBarSlot)),
	hotbar: Type.Optional(Type.Record(Type.String(), Type.String())),
	personal_logistic_slots: Type.Optional(jsonPersonalLogisticSlots),
	crafting_queue: Type.Optional(jsonCraftingQueue),
	recipe_notifications: Type.Optional(Type.String()),
	components: Type.Optional(jsonTable),
	...jsonReserved,
});

export class AcquireResponse {
	constructor(
		public status: string,
		public generation?: number,
		public hasData?: boolean,
		public message?: string,
		public epoch?: number,
	) {
	}

	static jsonSchema = Type.Object({
		"status": StringEnum(["acquired", "error", "busy"]),
		"generation": Type.Optional(Type.Integer()),
		"hasData": Type.Optional(Type.Boolean()),
		"message": Type.Optional(Type.String()),
		"epoch": Type.Optional(Type.Integer()),
	});

	static fromJSON(json: Static<typeof AcquireResponse.jsonSchema>): AcquireResponse {
		return new this(json.status, json.generation, json.hasData, json.message, json.epoch);
	}
};
export class AcquireRequest {
	declare ["constructor"]: typeof AcquireRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "player_sync" as const;
	static Response = AcquireResponse;

	constructor(
		public instanceId: number,
		public playerName: string,
	) {
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Number(),
		"playerName": Type.String(),
	});

	static fromJSON(json: Static<typeof AcquireRequest.jsonSchema>): AcquireRequest {
		return new this(json.instanceId, json.playerName);
	}
}

export class ReleaseRequest {
	declare ["constructor"]: typeof ReleaseRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "player_sync" as const;

	constructor(
		public instanceId: number,
		public playerName: string
	) {
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"playerName": Type.String(),
	});

	static fromJSON(json: Static<typeof ReleaseRequest.jsonSchema>) {
		return new this(json.instanceId, json.playerName);
	}
}

export class UploadRequest {
	declare ["constructor"]: typeof UploadRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "player_sync" as const;

	constructor(
		public instanceId: number,
		public playerName: string,
		public playerData: IpcPlayerData,
		public destinationInstanceId?: number,
	) {
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"playerName": Type.String(),
		"playerData": jsonPlayerData,
		"destinationInstanceId": Type.Optional(Type.Integer()),
	});

	static fromJSON(json: Static<typeof UploadRequest.jsonSchema>) {
		return new this(json.instanceId, json.playerName, json.playerData as IpcPlayerData, json.destinationInstanceId);
	}
}

/** The stored data of a player switching to the instance it is sent to, so the join there needs no download */
export class PrefetchEvent {
	declare ["constructor"]: typeof PrefetchEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "instance" as const;
	static plugin = "player_sync" as const;

	constructor(
		public playerData: IpcPlayerData,
	) {
	}

	static jsonSchema = Type.Object({
		"playerData": jsonPlayerData,
	});

	static fromJSON(json: Static<typeof PrefetchEvent.jsonSchema>): PrefetchEvent {
		return new this(json.playerData as IpcPlayerData);
	}
}

export class DownloadResponse {
	constructor(
		public playerData: IpcPlayerData | null
	) {
	}

	static jsonSchema = Type.Object({
		"playerData": Type.Optional(jsonPlayerData),
	});

	static fromJSON(json: Static<typeof DownloadResponse.jsonSchema>): DownloadResponse {
		return new this(json.playerData as IpcPlayerData);
	}
}

export class DownloadRequest {
	declare ["constructor"]: typeof DownloadRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "player_sync" as const;
	static Response = DownloadResponse;

	constructor(
		public instanceId: number,
		public playerName: string,
	) {
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"playerName": Type.String(),
	});

	static fromJSON(json: Static<typeof DownloadRequest.jsonSchema>) {
		return new this(json.instanceId, json.playerName);
	}
}

export class DatabaseStatsResponse {
	constructor(
		public databaseSize: number,
		public databaseEntries: number,
		public largestEntry: { name: string, size: number },
	) {
	}

	static jsonSchema = Type.Object({
		"databaseSize": Type.Integer(),
		"databaseEntries": Type.Integer(),
		"largestEntry": Type.Object({
			"name": Type.String(),
			"size": Type.Number(),
		}),
	});

	static fromJSON(json: Static<typeof DatabaseStatsResponse.jsonSchema>): DatabaseStatsResponse {
		return new this(json.databaseSize, json.databaseEntries, json.largestEntry);
	}
}

export class DatabaseStatsRequest {
	declare ["constructor"]: typeof DatabaseStatsRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "player_sync" as const;
	static permission = "player_sync.inventory.view" as const;
	static Response = DatabaseStatsResponse;
}

export class PlayerEntry {
	constructor(
		public name: string,
		public generation?: number,
		public size?: number,
		public instanceId?: number,
		public force?: string,
	) {
	}

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"generation": Type.Optional(Type.Integer()),
		"size": Type.Optional(Type.Integer()),
		"instanceId": Type.Optional(Type.Integer()),
		"force": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof PlayerEntry.jsonSchema>): PlayerEntry {
		return new this(json.name, json.generation, json.size, json.instanceId, json.force);
	}
}

export class ListPlayersRequest {
	declare ["constructor"]: typeof ListPlayersRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "player_sync" as const;
	static permission = "player_sync.inventory.view" as const;
	static Response = jsonArray(PlayerEntry);
}

export class GetPlayerDataResponse {
	constructor(
		public playerData: IpcPlayerData | null,
		public instanceId?: number,
	) {
	}

	static jsonSchema = Type.Object({
		"playerData": Type.Union([jsonPlayerData, Type.Null()]),
		"instanceId": Type.Optional(Type.Integer()),
	});

	static fromJSON(json: Static<typeof GetPlayerDataResponse.jsonSchema>): GetPlayerDataResponse {
		return new this(json.playerData as IpcPlayerData | null, json.instanceId);
	}
}

export class GetPlayerDataRequest {
	declare ["constructor"]: typeof GetPlayerDataRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "player_sync" as const;
	static permission = "player_sync.inventory.view" as const;
	static Response = GetPlayerDataResponse;

	constructor(
		public playerName: string,
	) {
	}

	static jsonSchema = Type.Object({
		"playerName": Type.String(),
	});

	static fromJSON(json: Static<typeof GetPlayerDataRequest.jsonSchema>) {
		return new this(json.playerName);
	}
}

export class SetPlayerDataResponse {
	constructor(
		public generation: number,
	) {
	}

	static jsonSchema = Type.Object({
		"generation": Type.Integer(),
	});

	static fromJSON(json: Static<typeof SetPlayerDataResponse.jsonSchema>): SetPlayerDataResponse {
		return new this(json.generation);
	}
}

export class SetPlayerDataRequest {
	declare ["constructor"]: typeof SetPlayerDataRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "player_sync" as const;
	static permission = "player_sync.inventory.modify" as const;
	static Response = SetPlayerDataResponse;

	constructor(
		public playerName: string,
		public playerData: IpcPlayerData,
	) {
	}

	static jsonSchema = Type.Object({
		"playerName": Type.String(),
		"playerData": jsonImportedPlayerData,
	});

	static fromJSON(json: Static<typeof SetPlayerDataRequest.jsonSchema>) {
		return new this(json.playerName, json.playerData as IpcPlayerData);
	}
}

export class DeletePlayerDataRequest {
	declare ["constructor"]: typeof DeletePlayerDataRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "player_sync" as const;
	static permission = "player_sync.inventory.modify" as const;

	constructor(
		public playerName: string,
	) {
	}

	static jsonSchema = Type.Object({
		"playerName": Type.String(),
	});

	static fromJSON(json: Static<typeof DeletePlayerDataRequest.jsonSchema>) {
		return new this(json.playerName);
	}
}

export class ForceReleaseRequest {
	declare ["constructor"]: typeof ForceReleaseRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "player_sync" as const;
	static permission = "player_sync.inventory.modify" as const;

	constructor(
		public playerName: string,
	) {
	}

	static jsonSchema = Type.Object({
		"playerName": Type.String(),
	});

	static fromJSON(json: Static<typeof ForceReleaseRequest.jsonSchema>) {
		return new this(json.playerName);
	}
}
