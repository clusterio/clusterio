"use strict";
const libLink = require("@clusterio/lib/link");
const libConfig = require("@clusterio/lib/config");
const libUsers = require("@clusterio/lib/users");

class MasterConfigGroup extends libConfig.PluginConfigGroup {}
MasterConfigGroup.defaultAccess = ["master", "slave", "control"];
MasterConfigGroup.groupName = "subspace_storage";
MasterConfigGroup.define({
	name: "autosave_interval",
	title: "Autosave Interval",
	description: "Interval the storage is autosaved at in seconds.",
	type: "number",
	initial_value: 60,
});
MasterConfigGroup.define({
	name: "division_method",
	title: "Division Method",
	description: "Method for dividing resource requests between instances.",
	type: "string",
	enum: ["simple", "dole", "neural_dole"],
	initial_value: "simple",
});
MasterConfigGroup.define({
	name: "log_item_transfers",
	title: "Log Item Transfers",
	description: "Spam master console with item transfers done.",
	type: "boolean",
	initial_value: false,
});
MasterConfigGroup.finalize();

class InstanceConfigGroup extends libConfig.PluginConfigGroup {}
InstanceConfigGroup.defaultAccess = ["master", "slave", "control"];
InstanceConfigGroup.groupName = "subspace_storage";
InstanceConfigGroup.define({
	name: "log_item_transfers",
	title: "Log Item Transfers",
	description: "Spam slave console with item transfers done.",
	type: "boolean",
	initial_value: false,
});
InstanceConfigGroup.finalize();

libUsers.definePermission({
	name: "subspace_storage.storage.view",
	title: "View Subspace Storage",
	description: "View the items and fluids stored in the shared subspace.",
	grantByDefault: true,
});

// JSON schema for subspace storage items
const items = {
	type: "array",
	items: {
		type: "array",
		minItems: 2,
		maxItems: 2,
		items: [
			{ type: "string" },
			{ type: "integer" },
		],
	},
};

module.exports = {
	name: "subspace_storage",
	title: "Subspace Storage",
	description: "Provides shared storage across instances for the Subspace Storage mod",
	instanceEntrypoint: "instance",
	InstanceConfigGroup,

	masterEntrypoint: "master",
	MasterConfigGroup,

	webEntrypoint: "./web",
	routes: ["/storage"],

	messages: {
		// XXX this should be a request to be reliable
		place: new libLink.Event({
			type: "subspace_storage:place",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			eventProperties: {
				"instance_id": { type: "integer" },
				"items": items,
			},
		}),
		remove: new libLink.Request({
			type: "subspace_storage:remove",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			requestProperties: {
				"instance_id": { type: "integer" },
				"items": items,
			},
			responseProperties: {
				"items": items,
			},
		}),
		getStorage: new libLink.Request({
			type: "subspace_storage:get_storage",
			links: ["instance-slave", "slave-master", "control-master"],
			permission: "subspace_storage.storage.view",
			forwardTo: "master",
			responseProperties: {
				"items": items,
			},
		}),
		updateStorage: new libLink.Event({
			type: "subspace_storage:update_storage",
			links: ["master-slave", "slave-instance", "master-control"],
			broadcastTo: "instance",
			eventProperties: {
				"items": items,
			},
		}),

		setStorageSubscription: new libLink.Request({
			type: "subspace_storage:set_storage_subscription",
			links: ["control-master"],
			permission: "subspace_storage.storage.view",
			requestProperties: {
				"storage": { type: "boolean" },
			},
		}),
	},
};
