import * as lib from "@clusterio/lib";

import {
	TileDataEvent,
	ChartTagDataEvent,
	PlayerPositionEvent,
	GetRawTileRequest,
	GetChartTagsRequest,
	GetPlayerPathRequest,
	RecipeDataEvent,
	GetRawRecipeTileRequest,
	ClearMinimapSurfaceDataRequest,
	ClearMinimapDataRequest,
} from "./messages";

// Define permissions
lib.definePermission({
	name: "minimap.view",
	title: "View Minimap",
	description: "View the interactive minimap of Factorio instances.",
	grantByDefault: true,
});
lib.definePermission({
	name: "minimap.manage",
	title: "Manage Minimap Data",
	description: "Delete cached minimap data through the web interface.",
});

export const plugin: lib.PluginDeclaration = {
	name: "minimap",
	title: "Minimap",
	description: "Provides interactive minimaps of Factorio instances with real-time tile and entity data.",
	instanceEntrypoint: "dist/node/instance",
	controllerEntrypoint: "dist/node/controller",
	webEntrypoint: "./web",

	messages: [
		TileDataEvent,
		ChartTagDataEvent,
		PlayerPositionEvent,
		RecipeDataEvent,
		GetRawTileRequest,
		GetChartTagsRequest,
		GetPlayerPathRequest,
		GetRawRecipeTileRequest,
		ClearMinimapSurfaceDataRequest,
		ClearMinimapDataRequest,
	],
	routes: ["/minimap"],
};
