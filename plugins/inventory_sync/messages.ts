import type { IpcPlayerData } from "./instance";

import { Type, Static } from "@sinclair/typebox";
import { StringEnum } from "@clusterio/lib";

import { Request } from "@clusterio/lib";

const jsonPlayerData = Type.Object({
	generation: Type.Number(),
	name: Type.String(),
})

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
export class AcquireRequest implements Request<AcquireRequest, AcquireResponse> {
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
	})

	static fromJSON(json: Static<typeof AcquireRequest.jsonSchema>): AcquireRequest {
		return new this(json.instanceId, json.playerName);
	}
}

export class ReleaseRequest implements Request<ReleaseRequest> {
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
	})

	static fromJSON(json: Static<typeof ReleaseRequest.jsonSchema>) {
		return new this(json.instanceId, json.playerName);
	}
}

export class UploadRequest implements Request<UploadRequest> {
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
	})

	static fromJSON(json: Static<typeof DownloadResponse.jsonSchema>): DownloadResponse {
		return new this(json.playerData as IpcPlayerData);
	}
}

export class DownloadRequest implements Request<DownloadRequest, DownloadResponse> {
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

export class DatabaseStatsRequest implements Request<DatabaseStatsRequest, DatabaseStatsResponse> {
	declare ["constructor"]: typeof DatabaseStatsRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "inventory_sync" as const;
	static permission = "inventory_sync.inventory.view" as const;
	static Response = DatabaseStatsResponse;
}
