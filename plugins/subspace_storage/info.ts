"use strict";
const lib = require("@clusterio/lib");
const messages = require("./messages");

class ControllerConfigGroup extends lib.PluginConfigGroup {}
ControllerConfigGroup.defaultAccess = ["controller", "host", "control"];
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

class InstanceConfigGroup extends lib.PluginConfigGroup {}
InstanceConfigGroup.defaultAccess = ["controller", "host", "control"];
InstanceConfigGroup.groupName = "subspace_storage";
InstanceConfigGroup.define({
	name: "log_item_transfers",
	title: "Log Item Transfers",
	description: "Spam host console with item transfers done.",
	type: "boolean",
	initial_value: false,
});
InstanceConfigGroup.finalize();

lib.definePermission({
	name: "subspace_storage.storage.view",
	title: "View Subspace Storage",
	description: "View the items and fluids stored in the shared subspace.",
	grantByDefault: true,
});

module.exports.default = {
	name: "subspace_storage",
	title: "Subspace Storage",
	description: "Provides shared storage across instances for the Subspace Storage mod",
	instanceEntrypoint: "instance",
	InstanceConfigGroup,

	controllerEntrypoint: "controller",
	ControllerConfigGroup,

	messages: [
		messages.PlaceEvent,
		messages.RemoveRequest,
		messages.GetStorageRequest,
		messages.UpdateStorageEvent,
		messages.SetStorageSubscriptionRequest,
	],
	webEntrypoint: "./web",
	routes: ["/storage"],
};
