import * as lib from "@clusterio/lib";
import * as messages from "./messages";

class ControllerConfigGroup extends lib.PluginConfigGroup {}
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

export default {
	name: "player_auth",
	title: "Player Auth",
	description: "Provides authentication to the cluster via logging into a Factorio server.",
	controllerEntrypoint: "dist/plugin/controller",
	instanceEntrypoint: "dist/plugin/instance",
	webEntrypoint: "./web",
	ControllerConfigGroup,

	messages: [
		messages.FetchPlayerCodeRequest,
		messages.SetVerifyCodeRequest,
	],
} satisfies lib.PluginDeclaration;
