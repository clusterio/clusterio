"use strict";
let { libConfig, libLink } = require("@clusterio/lib");


class MasterConfigGroup extends libConfig.PluginConfigGroup {}
MasterConfigGroup.defaultAccess = ["master", "slave", "control"];
MasterConfigGroup.groupName = "player_auth";
MasterConfigGroup.define({
	name: "code_length",
	title: "Code Length",
	description: "Length in characters of the generated codes.",
	type: "number",
	initial_value: 6,
});
MasterConfigGroup.define({
	name: "code_timeout",
	title: "Code Timeout",
	description: "Time in seconds for the generated codes to stay valid.",
	type: "number",
	initial_value: 120,
});
MasterConfigGroup.finalize();

module.exports = {
	name: "player_auth",
	title: "Player Auth",
	description: "Provides authentication to the cluster via logging into a Factorio server.",
	masterEntrypoint: "master",
	instanceEntrypoint: "instance",
	webEntrypoint: "./web",
	MasterConfigGroup,

	messages: {
		fetchPlayerCode: new libLink.Request({
			type: "player_auth:fetch_player_code",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			requestProperties: {
				"player": { type: "string" },
			},
			responseProperties: {
				"player_code": { type: "string" },
				"master_url": { type: "string" },
			},
		}),
		setVerifyCode: new libLink.Request({
			type: "player_auth:set_verify_code",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			requestProperties: {
				"player": { type: "string" },
				"verify_code": { type: "string" },
			},
		}),
	},
};
