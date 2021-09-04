"use strict";
const { libConfig, libLink, libUsers } = require("@clusterio/lib");

class MasterConfigGroup extends libConfig.PluginConfigGroup { }
MasterConfigGroup.defaultAccess = ["master", "slave", "control"];
MasterConfigGroup.groupName = "inventory_sync";
MasterConfigGroup.define({
	name: "autosave_interval",
	title: "Autosave Interval",
	description: "Interval the player data is autosaved at in seconds.",
	type: "number",
	initial_value: 600, // 10 minutes
});
MasterConfigGroup.define({
	name: "player_lock_timeout",
	title: "Player Lock Timeout",
	description:
		"Time in seconds before the lock on a player inventory expires after an instance stops or is disconnected",
	type: "number",
	initial_value: 60,
});
MasterConfigGroup.finalize();

class InstanceConfigGroup extends libConfig.PluginConfigGroup { }
InstanceConfigGroup.defaultAccess = ["master", "slave", "control"];
InstanceConfigGroup.groupName = "inventory_sync";
InstanceConfigGroup.define({
	name: "rcon_chunk_size",
	title: "Rcon inventory chunk size",
	description: "Divide inventories into multiple chunks before sending with rcon to prevent blocking the pipe",
	type: "number",
	initial_value: 1000,
});
InstanceConfigGroup.finalize();

libUsers.definePermission({
	name: "inventory_sync.inventory.view",
	title: "View player inventories",
	description: "View player inventories",
	grantByDefault: true,
});

module.exports = {
	name: "inventory_sync",
	title: "Inventory sync",
	description: "Synchronizes players inventories between instances",

	instanceEntrypoint: "instance",
	InstanceConfigGroup,

	masterEntrypoint: "master",
	MasterConfigGroup,

	webEntrypoint: "./web",
	routes: ["/inventory"],

	messages: {
		acquire: new libLink.Request({
			type: "inventory_sync:acquire",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			requestProperties: {
				"instance_id": { type: "integer" },
				"player_name": { type: "string" },
			},
			responseRequired: ["status"],
			responseProperties: {
				"status": { enum: ["acquired", "error", "busy"] },
				"generation": { type: "integer" },
				"has_data": { type: "boolean" },
				"message": { type: "string" },
			},
		}),
		release: new libLink.Request({
			type: "inventory_sync:release",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			requestProperties: {
				"instance_id": { type: "integer" },
				"player_name": { type: "string" },
			},
		}),
		upload: new libLink.Request({
			type: "inventory_sync:upload",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			requestProperties: {
				"instance_id": { type: "integer" },
				"player_name": { type: "string" },
				"player_data": { type: "object" },
			},
		}),
		download: new libLink.Request({
			type: "inventory_sync:download",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			requestProperties: {
				"instance_id": { type: "integer" },
				"player_name": { type: "string" },
			},
			responseProperties: {
				"player_data": { type: ["object", "null"] },
			},
		}),
		databaseStats: new libLink.Request({
			type: "inventory_sync:databaseStats",
			links: ["control-master"],
			permission: "inventory_sync.inventory.view",
			responseProperties: {
				"database_size": { type: "integer" },
				"database_entries": { type: "integer" },
				"largest_entry": {
					type: "object",
					properties: {
						name: { type: "string" },
						size: { type: "number" },
					},
				},
			},
		}),
	},
};
