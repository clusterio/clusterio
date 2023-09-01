import * as lib from "@clusterio/lib";
import * as messages from "./messages";

class ControllerConfigGroup extends lib.PluginConfigGroup { }
ControllerConfigGroup.defaultAccess = ["controller", "host", "control"];
ControllerConfigGroup.groupName = "inventory_sync";
ControllerConfigGroup.define({
	name: "autosave_interval",
	title: "Autosave Interval",
	description: "Interval the player data is autosaved at in seconds.",
	type: "number",
	initial_value: 600, // 10 minutes
});
ControllerConfigGroup.define({
	name: "player_lock_timeout",
	title: "Player Lock Timeout",
	description:
		"Time in seconds before the lock on a player inventory expires after an instance stops or is disconnected",
	type: "number",
	initial_value: 60,
});
ControllerConfigGroup.finalize();

class InstanceConfigGroup extends lib.PluginConfigGroup { }
InstanceConfigGroup.defaultAccess = ["controller", "host", "control"];
InstanceConfigGroup.groupName = "inventory_sync";
InstanceConfigGroup.define({
	name: "rcon_chunk_size",
	title: "Rcon inventory chunk size",
	description: "Divide inventories into multiple chunks before sending with rcon to prevent blocking the pipe",
	type: "number",
	initial_value: 1000,
});
InstanceConfigGroup.finalize();

lib.definePermission({
	name: "inventory_sync.inventory.view",
	title: "View player inventories",
	description: "View player inventories",
	grantByDefault: true,
});

const info: lib.PluginInfoTs = {
	name: "inventory_sync",
	title: "Inventory sync",
	description: "Synchronizes players inventories between instances",

	instanceEntrypoint: "dist/plugin/instance",
	InstanceConfigGroup,

	controllerEntrypoint: "dist/plugin/controller",
	ControllerConfigGroup,

	messages: [
		messages.AcquireRequest,
		messages.ReleaseRequest,
		messages.UploadRequest,
		messages.DownloadRequest,
		messages.DatabaseStatsRequest,
	],
	webEntrypoint: "./web",
	routes: ["/inventory"],
}

export default info;