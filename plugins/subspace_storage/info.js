"use strict";
const libLink = require("@clusterio/lib/link");
const libConfig = require("@clusterio/lib/config");

class MasterConfigGroup extends libConfig.PluginConfigGroup {}
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
	title: "Log Item Trassfers",
	description: "Spam master console with item transfers done.",
	type: "boolean",
	initial_value: false,
});
MasterConfigGroup.finalize();

class InstanceConfigGroup extends libConfig.PluginConfigGroup {}
InstanceConfigGroup.groupName = "subspace_storage";
InstanceConfigGroup.define({
	name: "log_item_transfers",
	title: "Log Item Trassfers",
	description: "Spam slave console with item transfers done.",
	type: "boolean",
	initial_value: false,
});
InstanceConfigGroup.finalize();

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
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			responseProperties: {
				"items": items,
			},
		}),
		updateStorage: new libLink.Event({
			type: "subspace_storage:update_storage",
			links: ["master-slave", "slave-instance"],
			broadcastTo: "instance",
			eventProperties: {
				"items": items,
			},
		}),
	},
};
