import { Type, Static } from "@sinclair/typebox";
import * as lib from "@clusterio/lib";

// Define the chart data structure
export const ChartDataSchema = Type.Object({
	surface: Type.String(),
	force: Type.String(),
	chart_data: Type.String(),
});

export type ChartData = Static<typeof ChartDataSchema>;

export class TileDataEvent {
	declare ["constructor"]: typeof TileDataEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "minimap" as const;
	static permission = null;

	constructor(
		public type: "chart",
		public data: ChartData[],
		public position: [number, number],
		public instanceId: number
	) {
	}

	static jsonSchema = Type.Object({
		"type": Type.Union([Type.Literal("chart")]),
		"data": Type.Array(ChartDataSchema),
		"position": Type.Array(Type.Number(), { minItems: 2, maxItems: 2 }),
		"instanceId": Type.Number(),
	});

	static fromJSON(json: Static<typeof TileDataEvent.jsonSchema>) {
		return new this(
			json.type, 
			json.data, 
			json.position as [number, number], 
			json.instanceId,
		);
	}
}

export class ChunkUpdateEvent {
	declare ["constructor"]: typeof ChunkUpdateEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static plugin = "minimap" as const;
	static permission = "minimap.view";

	constructor(
		public instanceId: number,
		public surface: string,
		public force: string,
		public chunkX: number,
		public chunkY: number,
		public imageData: string, // base64 encoded ImageData
	) {
	}

	static jsonSchema = Type.Object({
		"instanceId": Type.Number(),
		"surface": Type.String(),
		"force": Type.String(),
		"chunkX": Type.Number(),
		"chunkY": Type.Number(),
		"imageData": Type.String(),
	});

	static fromJSON(json: Static<typeof ChunkUpdateEvent.jsonSchema>) {
		return new this(
			json.instanceId,
			json.surface,
			json.force,
			json.chunkX,
			json.chunkY,
			json.imageData,
		);
	}
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
