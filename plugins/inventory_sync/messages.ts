import { Type, type Static } from "@sinclair/typebox";
import { StringEnum } from "@clusterio/lib";

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
	status: string;
	generation?: number;
	hasData?: boolean;
	message?: string;

	constructor(
		status: string,
		generation?: number,
		hasData?: boolean,
		message?: string,
	) {
		this.status = status;
		this.generation = generation;
		this.hasData = hasData;
		this.message = message;
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

	instanceId: number;
	playerName: string;

	constructor(
		instanceId: number,
		playerName: string,
	) {
		this.instanceId = instanceId;
		this.playerName = playerName;
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

	instanceId: number;
	playerName: string;

	constructor(
		instanceId: number,
		playerName: string,
	) {
		this.instanceId = instanceId;
		this.playerName = playerName;
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

	instanceId: number;
	playerName: string;
	playerData: IpcPlayerData;

	constructor(
		instanceId: number,
		playerName: string,
		playerData: IpcPlayerData,
	) {
		this.instanceId = instanceId;
		this.playerName = playerName;
		this.playerData = playerData;
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
	playerData: IpcPlayerData | null;

	constructor(
		playerData: IpcPlayerData | null,
	) {
		this.playerData = playerData;
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

	instanceId: number;
	playerName: string;

	constructor(
		instanceId: number,
		playerName: string,
	) {
		this.instanceId = instanceId;
		this.playerName = playerName;
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
	databaseSize: number;
	databaseEntries: number;
	largestEntry: { name: string, size: number };

	constructor(
		databaseSize: number,
		databaseEntries: number,
		largestEntry: { name: string, size: number },
	) {
		this.databaseSize = databaseSize;
		this.databaseEntries = databaseEntries;
		this.largestEntry = largestEntry;
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
