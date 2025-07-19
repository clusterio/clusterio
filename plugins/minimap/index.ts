import * as lib from "@clusterio/lib";

import {
	TileDataEvent,
	ChartTagDataEvent,
	GetRawTileRequest,
	GetChartTagsRequest,
} from "./messages";

// Define permissions
lib.definePermission({
	name: "minimap.view",
	title: "View Minimap",
	description: "View the interactive minimap of Factorio instances.",
	grantByDefault: true,
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
		GetRawTileRequest,
		GetChartTagsRequest,
	],
	routes: ["/minimap"],
};
