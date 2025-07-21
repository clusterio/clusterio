import { Type, Static } from "@sinclair/typebox";
import * as lib from "@clusterio/lib";

// Define the chart data structure
export const ChartDataSchema = Type.Object({
	surface: Type.String(),
	force: Type.String(),
	chart_data: Type.String(),
});

export type ChartData = Static<typeof ChartDataSchema>;

// Define the SignalID structure (based on Factorio API)
export const SignalIDSchema = Type.Object({
	type: Type.Optional(Type.String()), // SignalIDType, nil when reading for "item" type
	name: Type.Optional(Type.String()), // Name of the prototype
	quality: Type.Optional(Type.String()), // Quality name, defaults to "normal"
});

export type SignalID = Static<typeof SignalIDSchema>;

// Define the chart tag data structure
export const ChartTagDataSchema = Type.Object({
	tag_number: Type.Number(),
	start_tick: Type.Optional(Type.Number()),
	end_tick: Type.Optional(Type.Number()),
	force: Type.String(),
	surface: Type.String(),
	position: Type.Tuple([Type.Number(), Type.Number()]),
	text: Type.String(),
	icon: Type.Optional(SignalIDSchema),
	last_user: Type.Optional(Type.String()),
});

export type ChartTagData = Static<typeof ChartTagDataSchema>;

export const RecipeDataSchema = Type.Object({
	start_tick: Type.Optional(Type.Number()),
	end_tick: Type.Optional(Type.Number()),
	surface: Type.String(),
	force: Type.String(),
	position: Type.Tuple([Type.Number(), Type.Number()]),
	recipe: Type.Optional(Type.String()),
	icon: Type.Optional(SignalIDSchema),
});

export type RecipeData = Static<typeof RecipeDataSchema>;

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
	static src = ["instance", "controller"] as const;
	static dst = ["controller", "control"] as const;
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

/**
 * ChartTagDataEvent: Used for both Factorio Instance -> Controller and Controller -> Web Clients
 *
 * Contains chart tag information from Factorio's map tags.
 * When sent from instance to controller: triggers storage for tag history and timelapse.
 * When sent from controller to web clients: enables real-time tag updates.
 *
 * Data flow:
 * - Lua module -> Instance plugin -> Controller plugin (for persistence)
 * - Controller plugin -> Web UI plugin -> Tag renderer (for live updates)
 */
export class ChartTagDataEvent {
	declare ["constructor"]: typeof ChartTagDataEvent;
	static type = "event" as const;
	static src = ["instance", "controller"] as const;
	static dst = ["controller", "control"] as const;
	static plugin = "minimap" as const;
	static permission = null;

	constructor(
		public instance_id: number,
		public tag_data: ChartTagData,
	) { }

	static jsonSchema = Type.Object({
		"instance_id": Type.Number(),
		"tag_data": ChartTagDataSchema,
	});

	static fromJSON(json: Static<typeof ChartTagDataEvent.jsonSchema>) {
		return new this(
			json.instance_id,
			json.tag_data
		);
	}
}

export class RecipeDataEvent {
	declare ["constructor"]: typeof RecipeDataEvent;
	static type = "event" as const;
	static src = ["instance", "controller"] as const;
	static dst = ["controller", "control"] as const;
	static plugin = "minimap" as const;
	static permission = null;

	constructor(
        public instance_id: number,
        public recipe_data: RecipeData,
	) {}

	static jsonSchema = Type.Object({
		"instance_id": Type.Number(),
		"recipe_data": RecipeDataSchema,
	});

	static fromJSON(json: Static<typeof RecipeDataEvent.jsonSchema>) {
		return new this(
			json.instance_id,
			json.recipe_data
		);
	}
}

/**
 * GetRawTileRequest: Request raw tile data from controller storage
 *
 * Returns base64-encoded tile data that can be processed in timelapse mode
 * or for initial tile loading when canvas minimap starts up.
 */
export class GetRawTileRequest {
	declare ["constructor"]: typeof GetRawTileRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "minimap" as const;
	static permission = "minimap.view";

	constructor(
		public instance_id: number,
		public surface: string,
		public force: string,
		public tile_x: number,
		public tile_y: number,
		public tick?: number,
	) { }

	static jsonSchema = Type.Object({
		"instance_id": Type.Number(),
		"surface": Type.String(),
		"force": Type.String(),
		"tile_x": Type.Number(),
		"tile_y": Type.Number(),
		"tick": Type.Optional(Type.Number()),
	});

	static fromJSON(json: Static<typeof GetRawTileRequest.jsonSchema>) {
		return new this(
			json.instance_id,
			json.surface,
			json.force,
			json.tile_x,
			json.tile_y,
			json.tick
		);
	}

	static Response = lib.plainJson(Type.Object({
		"tile_data": Type.Union([Type.String(), Type.Null()]), // Base64 encoded tile file or null if not found
	}));
}

/**
 * GetChartTagsRequest: Request existing chart tags from controller storage
 *
 * Returns all saved chart tags for a specific instance/surface/force combination.
 * Used to load existing chart tags when the web UI starts up or selection changes.
 */
export class GetChartTagsRequest {
	declare ["constructor"]: typeof GetChartTagsRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "minimap" as const;
	static permission = "minimap.view";

	constructor(
		public instance_id: number,
		public surface: string,
		public force: string,
	) { }

	static jsonSchema = Type.Object({
		"instance_id": Type.Number(),
		"surface": Type.String(),
		"force": Type.String(),
	});

	static fromJSON(json: Static<typeof GetChartTagsRequest.jsonSchema>) {
		return new this(
			json.instance_id,
			json.surface,
			json.force
		);
	}

	static Response = lib.plainJson(Type.Object({
		"chart_tags": Type.Array(ChartTagDataSchema),
	}));
}

export class GetRawRecipeTileRequest {
	declare ["constructor"]: typeof GetRawRecipeTileRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "minimap" as const;
	static permission = "minimap.view";

	constructor(
        public instance_id: number,
        public surface: string,
        public force: string,
        public tile_x: number,
        public tile_y: number,
        public tick?: number,
	) {}

	static jsonSchema = Type.Object({
		"instance_id": Type.Number(),
		"surface": Type.String(),
		"force": Type.String(),
		"tile_x": Type.Number(),
		"tile_y": Type.Number(),
		"tick": Type.Optional(Type.Number()),
	});

	static fromJSON(json: Static<typeof GetRawRecipeTileRequest.jsonSchema>) {
		return new this(
			json.instance_id,
			json.surface,
			json.force,
			json.tile_x,
			json.tile_y,
			json.tick
		);
	}

	static Response = lib.plainJson(Type.Object({
		"recipe_tile": Type.Union([Type.String(), Type.Null()]),
	}));
}
