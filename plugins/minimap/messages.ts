import { Type, Static } from "@sinclair/typebox";
import * as lib from "@clusterio/lib";

export class TileDataEvent {
	declare ["constructor"]: typeof TileDataEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "minimap" as const;
	static permission = null;

	constructor(
		public type: "tiles" | "pixels",
		public data: string[],
		public position: [number, number] | null,
		public size: number | null,
		public instanceId: number,
		public layer: string = ""
	) {
	}

	static jsonSchema = Type.Object({
		"type": Type.Union([Type.Literal("tiles"), Type.Literal("pixels")]),
		"data": Type.Array(Type.String()),
		"position": Type.Union([Type.Array(Type.Number(), { minItems: 2, maxItems: 2 }), Type.Null()]),
		"size": Type.Union([Type.Number(), Type.Null()]),
		"instanceId": Type.Number(),
		"layer": Type.String(),
	});

	static fromJSON(json: Static<typeof TileDataEvent.jsonSchema>) {
		return new this(
			json.type, 
			json.data, 
			json.position as [number, number] | null, 
			json.size, 
			json.instanceId, 
			json.layer
		);
	}
}

export class RefreshTileDataRequest {
	declare ["constructor"]: typeof RefreshTileDataRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "minimap" as const;
	static permission = "minimap.refresh";

	constructor(
		public instanceId: number,
		public area?: { x1: number; y1: number; x2: number; y2: number }
	) {
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Number(),
		"area": Type.Optional(Type.Object({
			"x1": Type.Number(),
			"y1": Type.Number(),
			"x2": Type.Number(),
			"y2": Type.Number(),
		})),
	});

	static fromJSON(json: Static<typeof RefreshTileDataRequest.jsonSchema>) {
		return new this(json.instanceId, json.area);
	}

	static Response = lib.plainJson(Type.Object({
		"success": Type.Boolean(),
		"message": Type.Optional(Type.String()),
	}));
}

export class GetTileDataRequest {
	declare ["constructor"]: typeof GetTileDataRequest;
	static type = "request" as const;
	static src = "controller" as const;
	static dst = "instance" as const;
	static plugin = "minimap" as const;
	static permission = null;

	constructor(
		public area: { x1: number; y1: number; x2: number; y2: number }
	) {
	}

	static jsonSchema = Type.Object({
		"area": Type.Object({
			"x1": Type.Number(),
			"y1": Type.Number(),
			"x2": Type.Number(),
			"y2": Type.Number(),
		}),
	});

	static fromJSON(json: Static<typeof GetTileDataRequest.jsonSchema>) {
		return new this(json.area);
	}

	static Response = lib.plainJson(Type.Object({
		"tileData": Type.Array(Type.String()),
	}));
}

export class GetInstanceBoundsRequest {
	declare ["constructor"]: typeof GetInstanceBoundsRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "minimap" as const;
	static permission = "minimap.view";

	constructor() {
	}

	static jsonSchema = Type.Object({});

	static fromJSON(json: Static<typeof GetInstanceBoundsRequest.jsonSchema>) {
		return new this();
	}

	static Response = lib.plainJson(Type.Object({
		"instances": Type.Array(Type.Object({
			"instanceId": Type.Number(),
			"name": Type.String(),
			"bounds": Type.Object({
				"x1": Type.Number(),
				"y1": Type.Number(),
				"x2": Type.Number(),
				"y2": Type.Number(),
			}),
		})),
	}));
} 
