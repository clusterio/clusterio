import { Type, Static } from "@sinclair/typebox";
import { StringEnum, jsonArray } from "@clusterio/lib";

// .\module\serialize.lua:serialize.serialize_player()
export type IpcPlayerData = {
	generation: number,
	controller: string,
	name: string,
	color: number[],
	chat_color: number[],
	tag: string,
	force: string,
	cheat_mode: boolean,
	flashlight: boolean,
	shortcuts?: Record<string, boolean>,
	game_view_settings?: Record<string, boolean>,
	ticks_to_respawn?: number,
	character?: any,
	inventories?: any,
	hotbar?: string[],
	personal_logistic_slots?: {name:string, min:number, max:number}[],
	crafting_queue?: any,
	recipe_notifications?: string,
}

const jsonPlayerData = Type.Object({
	generation: Type.Number(),
	name: Type.String(),
});

export class AcquireResponse {
	constructor(
		public status: string,
		public generation?: number,
		public hasData?: boolean,
		public message?: string,
	) {
	}

	static jsonSchema = Type.Object({
		"status": StringEnum(["acquired", "error", "busy"]),
		"generation": Type.Optional(Type.Integer()),
		"hasData": Type.Optional(Type.Boolean()),
		"message": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof AcquireResponse.jsonSchema>): AcquireResponse {
		return new this(json.status, json.generation, json.hasData, json.message);
	}
};
export class AcquireRequest {
	declare ["constructor"]: typeof AcquireRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "inventory_sync" as const;
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
	static plugin = "inventory_sync" as const;

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
	static plugin = "inventory_sync" as const;

	constructor(
		public instanceId: number,
		public playerName: string,
		public playerData: IpcPlayerData,
	) {
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"playerName": Type.String(),
		"playerData": jsonPlayerData,
	});

	static fromJSON(json: Static<typeof UploadRequest.jsonSchema>) {
		return new this(json.instanceId, json.playerName, json.playerData as IpcPlayerData);
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
	static plugin = "inventory_sync" as const;
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
	static plugin = "inventory_sync" as const;
	static permission = "inventory_sync.inventory.view" as const;
	static Response = DatabaseStatsResponse;
}

export class PlayerEntry {
	constructor(
		public name: string,
		public generation?: number,
		public size?: number,
		public instanceId?: number,
	) {
	}

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"generation": Type.Optional(Type.Integer()),
		"size": Type.Optional(Type.Integer()),
		"instanceId": Type.Optional(Type.Integer()),
	});

	static fromJSON(json: Static<typeof PlayerEntry.jsonSchema>): PlayerEntry {
		return new this(json.name, json.generation, json.size, json.instanceId);
	}
}

export class ListPlayersRequest {
	declare ["constructor"]: typeof ListPlayersRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "inventory_sync" as const;
	static permission = "inventory_sync.inventory.view" as const;
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
	static plugin = "inventory_sync" as const;
	static permission = "inventory_sync.inventory.view" as const;
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
	static plugin = "inventory_sync" as const;
	static permission = "inventory_sync.inventory.modify" as const;
	static Response = SetPlayerDataResponse;

	constructor(
		public playerName: string,
		public playerData: IpcPlayerData,
	) {
	}

	static jsonSchema = Type.Object({
		"playerName": Type.String(),
		"playerData": jsonPlayerData,
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
	static plugin = "inventory_sync" as const;
	static permission = "inventory_sync.inventory.modify" as const;

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
	static plugin = "inventory_sync" as const;
	static permission = "inventory_sync.inventory.modify" as const;

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
