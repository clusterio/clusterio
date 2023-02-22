"use strict";
let { libConfig, libLink } = require("@clusterio/lib");


class ControllerConfigGroup extends libConfig.PluginConfigGroup {}
ControllerConfigGroup.defaultAccess = ["controller", "host", "control"];
ControllerConfigGroup.groupName = "player_auth";
ControllerConfigGroup.define({
	name: "code_length",
	title: "Code Length",
	description: "Length in characters of the generated codes.",
	type: "number",
	initial_value: 6,
});
ControllerConfigGroup.define({
	name: "code_timeout",
	title: "Code Timeout",
	description: "Time in seconds for the generated codes to stay valid.",
	type: "number",
	initial_value: 120,
});
ControllerConfigGroup.finalize();

module.exports = {
	name: "player_auth",
	title: "Player Auth",
	description: "Provides authentication to the cluster via logging into a Factorio server.",
	controllerEntrypoint: "controller",
	instanceEntrypoint: "instance",
	webEntrypoint: "./web",
	ControllerConfigGroup,

	messages: {
		fetchPlayerCode: new libLink.Request({
			type: "player_auth:fetch_player_code",
			links: ["instance-host", "host-controller"],
			forwardTo: "controller",
			requestProperties: {
				"player": { type: "string" },
			},
			responseProperties: {
				"player_code": { type: "string" },
				"controller_url": { type: "string" },
			},
		}),
		setVerifyCode: new libLink.Request({
			type: "player_auth:set_verify_code",
			links: ["instance-host", "host-controller"],
			forwardTo: "controller",
			requestProperties: {
				"player": { type: "string" },
				"verify_code": { type: "string" },
			},
		}),
	},
};
