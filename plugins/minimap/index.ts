import * as lib from "@clusterio/lib";

import {
	TileDataEvent,
	RefreshTileDataRequest,
	GetTileDataRequest,
	GetInstanceBoundsRequest,
} from "./messages";

// Define permissions
lib.definePermission({
	name: "minimap.view",
	title: "View Minimap",
	description: "View the interactive minimap of Factorio instances.",
	grantByDefault: true,
});

lib.definePermission({
	name: "minimap.refresh",
	title: "Refresh Minimap",
	description: "Refresh the minimap data for Factorio instances.",
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
		RefreshTileDataRequest,
		GetTileDataRequest,
		GetInstanceBoundsRequest,
	],
};
