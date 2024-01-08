import * as lib from "@clusterio/lib";

declare module "@clusterio/lib" {
	export interface InstanceConfigFields {
		"statistics_exporter.command_timeout": number;
	}
}

export default {
	name: "statistics_exporter",
	title: "Statistics Exporter",
	description:
		"Provides in-game item/fluid production, builds, kills, and pollution "+
		"statistics to the cluster's Prometheus endpoint.",
	instanceEntrypoint: "dist/plugin/instance",
	instanceConfigFields: {
		"statistics_exporter.command_timeout": {
			title: "Command Timeout",
			description:
				"Timeout in seconds of the metrics command before returning results from the previous invocation.",
			type: "number",
			initialValue: 1,
		},
	},
} satisfies lib.PluginDeclaration;
