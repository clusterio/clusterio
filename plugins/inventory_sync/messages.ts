import type { IpcPlayerData } from "./instance";

import { Type, Static } from "@sinclair/typebox";
import { StringEnum } from "@clusterio/lib";

const jsonPlayerData = Type.Object({
	generation: Type.Number(),
	name: Type.String(),
})

class AcquireResponse {
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
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "inventory_sync";
	static Response = AcquireResponse;

	constructor(
		public instanceId: number,
		public playerName: string,
	) {
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Number(),
		"playerName": Type.String(),
	})

	static fromJSON(json: Static<typeof AcquireRequest.jsonSchema>): AcquireRequest {
		return new this(json.instanceId, json.playerName);
	}
}

export class ReleaseRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "inventory_sync";

	constructor(
		public instanceId: number,
		public playerName: string
	) {
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"playerName": Type.String(),
	})

	static fromJSON(json: Static<typeof ReleaseRequest.jsonSchema>) {
		return new this(json.instanceId, json.playerName);
	}
}

export class UploadRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "inventory_sync";

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

class DownloadResponse {
	constructor(
		public playerData: IpcPlayerData | null
	) {
	}

	static jsonSchema = Type.Object({
		"playerData": Type.Optional(jsonPlayerData),
	})

	static fromJSON(json: Static<typeof DownloadResponse.jsonSchema>): DownloadResponse {
		return new this(json.playerData as IpcPlayerData);
	}
}

export class DownloadRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "inventory_sync";
	static Response = DownloadResponse;

	constructor(
		public instanceId: number,
		public playerName: string,
	) {
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Integer(),
		"playerName": Type.String(),
	})

	static fromJSON(json: Static<typeof DownloadRequest.jsonSchema>) {
		return new this(json.instanceId, json.playerName);
	}
}

class DatabaseStatsResponse {
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
		})
	})

	static fromJSON(json: Static<typeof DatabaseStatsResponse.jsonSchema>): DatabaseStatsResponse {
		return new this(json.databaseSize, json.databaseEntries, json.largestEntry);
	}
}

export class DatabaseStatsRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static plugin = "inventory_sync";
	static permission = "inventory_sync.inventory.view";
	static Response = DatabaseStatsResponse;
}
