import { Type, Static } from "@sinclair/typebox";
import * as lib from "@clusterio/lib";

// Define the chart data structure
export const ChartDataSchema = Type.Object({
	surface: Type.String(),
	force: Type.String(),
	chart_data: Type.String(),
});

export type ChartData = Static<typeof ChartDataSchema>;

/**
 * TileDataEvent: Used for both Factorio Instance -> Controller and Controller -> Web Clients
 * 
 * Contains compressed RGB565 chart data from Factorio's internal mapping system.
 * When sent from instance to controller: triggers storage in persistent tile files.
 * When sent from controller to web clients: enables real-time minimap updates.
 * 
 * Data flow: 
 * - Lua module -> Instance plugin -> Controller plugin (for persistence)
 * - Controller plugin -> Web UI plugin -> Canvas renderer (for live updates)
 */
export class TileDataEvent {
	declare ["constructor"]: typeof TileDataEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "minimap" as const;
	static permission = null;

	constructor(
		public instance_id: number,
		public surface: string,
		public force: string,
		public x: number,
		public y: number,
		public tick: number,
		public chunk: ChartData,
	) { }

	static jsonSchema = Type.Object({
		"instance_id": Type.Number(),
		"surface": Type.String(),
		"force": Type.String(),
		"x": Type.Number(),
		"y": Type.Number(),
		"tick": Type.Number(),
		"chunk": ChartDataSchema,
	});

	static fromJSON(json: Static<typeof TileDataEvent.jsonSchema>) {
		return new this(
			json.instance_id,
			json.surface,
			json.force,
			json.x,
			json.y,
			json.tick,
			json.chunk
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
