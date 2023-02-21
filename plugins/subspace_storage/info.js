"use strict";
const { libConfig, libLink, libUsers } = require("@clusterio/lib");

class ControllerConfigGroup extends libConfig.PluginConfigGroup {}
ControllerConfigGroup.defaultAccess = ["controller", "slave", "control"];
ControllerConfigGroup.groupName = "subspace_storage";
ControllerConfigGroup.define({
	name: "autosave_interval",
	title: "Autosave Interval",
	description: "Interval the storage is autosaved at in seconds.",
	type: "number",
	initial_value: 60,
});
ControllerConfigGroup.define({
	name: "division_method",
	title: "Division Method",
	description: "Method for dividing resource requests between instances.",
	type: "string",
	enum: ["simple", "dole", "neural_dole"],
	initial_value: "simple",
});
ControllerConfigGroup.define({
	name: "log_item_transfers",
	title: "Log Item Transfers",
	description: "Spam controller console with item transfers done.",
	type: "boolean",
	initial_value: false,
});
ControllerConfigGroup.finalize();

class InstanceConfigGroup extends libConfig.PluginConfigGroup {}
InstanceConfigGroup.defaultAccess = ["controller", "slave", "control"];
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

	controllerEntrypoint: "controller",
	ControllerConfigGroup,

	webEntrypoint: "./web",
	routes: ["/storage"],

	messages: {
		// XXX this should be a request to be reliable
		place: new libLink.Event({
			type: "subspace_storage:place",
			links: ["instance-slave", "slave-controller"],
			forwardTo: "controller",
			eventProperties: {
				"instance_id": { type: "integer" },
				"items": items,
			},
		}),
		remove: new libLink.Request({
			type: "subspace_storage:remove",
			links: ["instance-slave", "slave-controller"],
			forwardTo: "controller",
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
			links: ["instance-slave", "slave-controller", "control-controller"],
			permission: "subspace_storage.storage.view",
			forwardTo: "controller",
			responseProperties: {
				"items": items,
			},
		}),
		updateStorage: new libLink.Event({
			type: "subspace_storage:update_storage",
			links: ["controller-slave", "slave-instance", "controller-control"],
			broadcastTo: "instance",
			eventProperties: {
				"items": items,
			},
		}),

		setStorageSubscription: new libLink.Request({
			type: "subspace_storage:set_storage_subscription",
			links: ["control-controller"],
			permission: "subspace_storage.storage.view",
			requestProperties: {
				"storage": { type: "boolean" },
			},
		}),
	},
};
