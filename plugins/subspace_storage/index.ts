import * as lib from "@clusterio/lib";
import * as messages from "./messages";

declare module "@clusterio/lib" {
	export interface ControllerConfigFields {
		"subspace_storage.division_method": "simple" | "dole" | "neural_dole";
		"subspace_storage.log_item_transfers": boolean;
	}
	export interface InstanceConfigFields {
		"subspace_storage.log_item_transfers": boolean;
	}
}

lib.definePermission({
	name: "subspace_storage.storage.view",
	title: "View Subspace Storage",
	description: "View the items and fluids stored in the shared subspace.",
	grantByDefault: true,
});

export const plugin: lib.PluginDeclaration = {
	name: "subspace_storage",
	title: "Subspace Storage",
	description: "Provides shared storage across instances for the Subspace Storage mod",
	instanceEntrypoint: "dist/node/instance",
	instanceConfigFields: {
		"subspace_storage.log_item_transfers": {
			title: "Log Item Transfers",
			description: "Spam host console with item transfers done.",
			type: "boolean",
			initialValue: false,
		},
	},

	controllerEntrypoint: "dist/node/controller",
	controllerConfigFields: {
		"subspace_storage.division_method": {
			title: "Division Method",
			description: "Method for dividing resource requests between instances.",
			type: "string",
			enum: ["simple", "dole", "neural_dole"],
			initialValue: "simple",
		},
		"subspace_storage.log_item_transfers": {
			title: "Log Item Transfers",
			description: "Spam controller console with item transfers done.",
			type: "boolean",
			initialValue: false,
		},
	},

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
