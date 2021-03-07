"use strict";
const libConfig = require("@clusterio/lib/config");

class InstanceConfigGroup extends libConfig.PluginConfigGroup {}
InstanceConfigGroup.defaultAccess = ["master", "slave", "control"];
InstanceConfigGroup.groupName = "statistics_exporter";
InstanceConfigGroup.define({
	name: "command_timeout",
	title: "Command Timeout",
	description: "Timeout in seconds of the metrics command before returning results from the previous invocation.",
	type: "number",
	initial_value: 1,
});
InstanceConfigGroup.finalize();

module.exports = {
	name: "statistics_exporter",
	title: "Statistics Exporter",
	description:
		"Provides in-game item/fluid production, builds, kills, and pollution "+
		"statistics to the cluster's Prometheus endpoint.",
	instanceEntrypoint: "instance",
	InstanceConfigGroup,
};
