// Core definitions for the configuration system
import * as classes from "./classes";
import type { PluginNodeEnvInfo, PluginWebpackEnvInfo } from "../plugin";


/**
 * Controller config group for {@link ControllerConfig}
 * @extends classes.ConfigGroup
 */
export class ControllerGroup extends classes.ConfigGroup { }
ControllerGroup.defaultAccess = ["controller", "host", "control"];
ControllerGroup.groupName = "controller";
ControllerGroup.define({
	name: "name",
	title: "Name",
	description: "Name of the cluster.",
	type: "string",
	initial_value: "Your Cluster",
});
ControllerGroup.define({
	name: "mods_directory",
	title: "Mods Directory",
	description: "Path to directory where mods shared with the cluster are stored.",
	type: "string",
	initial_value: "mods",
});
ControllerGroup.define({
	name: "database_directory",
	title: "Database directory",
	description: "Directory where item and configuration data is stored.",
	type: "string",
	initial_value: "database",
});
ControllerGroup.define({
	name: "http_port",
	title: "HTTP Port",
	description: "Port to listen for HTTP connections on, set to null to not listen for HTTP connections.",
	restartRequired: true,
	type: "number",
	optional: true,
	initial_value: 8080,
});
ControllerGroup.define({
	name: "https_port",
	title: "HTTPS Port",
	description: "Port to listen for HTTPS connection on, set to null to not listen for HTTPS connections.",
	restartRequired: true,
	type: "number",
	optional: true,
});
ControllerGroup.define({
	name: "bind_address",
	title: "Bind Address",
	description: "IP address to bind the HTTP and HTTPS ports on.",
	restartRequired: true,
	type: "string",
	optional: true,
});
ControllerGroup.define({
	name: "external_address",
	title: "External Address",
	description: "Public facing address the controller is hosted on.",
	type: "string",
	optional: true,
});
ControllerGroup.define({
	name: "tls_certificate",
	title: "TLS Certificate",
	description: "Path to the certificate to use for HTTPS.",
	restartRequired: true,
	type: "string",
	optional: true,
});
ControllerGroup.define({
	name: "tls_private_key",
	title: "TLS Private Key",
	description: "Path to the private key to use for HTTPS.",
	restartRequired: true,
	type: "string",
	optional: true,
});
ControllerGroup.define({
	access: ["controller"],
	name: "auth_secret",
	title: "Controller Authentication Secret",
	description:
		"Secret used to generate and verify authentication tokens.  " +
		"Should be a long string of random letters and numbers.  " +
		"Do not share this.",
	restartRequired: true,
	type: "string",
	optional: true,
});
ControllerGroup.define({
	name: "heartbeat_interval",
	title: "Heartbeat Interval",
	description: "Interval heartbeats are sent out on WebSocket connections.",
	type: "number",
	initial_value: 15,
});
ControllerGroup.define({
	name: "session_timeout",
	title: "Session Timeout",
	description: "Time in seconds before giving up resuming a dropped WebSocket session.",
	type: "number",
	initial_value: 60,
});
ControllerGroup.define({
	name: "metrics_timeout",
	title: "Metrics Timeout",
	description: "Timeout in seconds for metrics gathering from hosts.",
	type: "number",
	initial_value: 8,
});
ControllerGroup.define({
	name: "proxy_stream_timeout",
	title: "Proxy Stream Timeout",
	description: "Timeout in seconds for proxy streams to start flowing.",
	type: "number",
	initial_value: 15,
});
ControllerGroup.define({
	name: "default_mod_pack_id",
	title: "Default Mod Pack",
	description: "Mod pack used by default for instances.",
	type: "number",
	optional: true,
});
ControllerGroup.define({
	name: "default_role_id",
	title: "Default role",
	description: "ID of role assigned by default to new users.",
	type: "number",
	optional: true,
	initial_value: 1,
});
ControllerGroup.finalize();

/**
 * Controller Config class
 * @extends classes.Config
 */
export class ControllerConfig extends classes.Config {
	get(name: "controller.name"): string;
	get(name: "controller.mods_directory"): string;
	get(name: "controller.database_directory"): string;
	get(name: "controller.http_port"): number | null;
	get(name: "controller.https_port"): number | null;
	get(name: "controller.bind_address"): string | null;
	get(name: "controller.external_address"): string | null;
	get(name: "controller.tls_certificate"): string | null;
	get(name: "controller.tls_private_key"): string | null;
	get(name: "controller.auth_secret"): string;
	get(name: "controller.heartbeat_interval"): number;
	get(name: "controller.session_timeout"): number;
	get(name: "controller.metrics_timeout"): number;
	get(name: "controller.proxy_stream_timeout"): number;
	get(name: "controller.default_mod_pack_id"): number | null;
	get(name: "controller.default_role_id"): number | null;
	get(name: string): unknown;
	get(name: string) {
		return super.get(name);
	}
}
ControllerConfig.registerGroup(ControllerGroup);


/**
 * Host config group for {@link HostConfig}
 * @extends classes.ConfigGroup
 */
export class HostGroup extends classes.ConfigGroup {}
HostGroup.defaultAccess = ["controller", "host", "control"];
HostGroup.groupName = "host";
HostGroup.define({
	name: "name",
	description: "Name of the host",
	type: "string",
	initial_value: "New Host",
});
HostGroup.define({
	name: "id",
	description: "ID of the host",
	type: "number",
	initial_value: () => Math.random() * 2**31 | 0,
});
HostGroup.define({
	name: "factorio_directory",
	description: "Path to directory to look for factorio installs",
	type: "string",
	initial_value: "factorio",
});
HostGroup.define({
	name: "mods_directory",
	title: "Mods Directory",
	description: "Path to directory where mods for instances are cached.",
	type: "string",
	initial_value: "mods",
});
HostGroup.define({
	name: "mods_directory_is_shared",
	title: "Mods Directory is Shared",
	description: "True if the mods directory is shared with the controller.",
	type: "boolean",
	initial_value: true,
});
HostGroup.define({
	name: "instances_directory",
	description: "Path to directory to store instances in.",
	restartRequired: true,
	type: "string",
	initial_value: "instances",
});
HostGroup.define({
	name: "controller_url",
	description: "URL to connect to the controller at",
	restartRequired: true,
	type: "string",
	initial_value: "http://localhost:8080/",
});
HostGroup.define({
	name: "controller_token",
	description: "Token to authenticate to controller with.",
	restartRequired: true,
	type: "string",
	initial_value: "enter token here",
});
HostGroup.define({
	name: "tls_ca",
	description: "Path to Certificate Authority to validate TLS connection to controller against.",
	restartRequired: true,
	type: "string",
	optional: true,
});
HostGroup.define({
	name: "public_address",
	description: "Public facing address players should connect to in order to join instances on this host",
	type: "string",
	initial_value: "localhost",
});
HostGroup.define({
	name: "max_reconnect_delay",
	title: "Max Reconnect Delay",
	description: "Maximum delay to wait before attempting to reconnect WebSocket",
	type: "number",
	initial_value: 60,
});
HostGroup.finalize();

/**
 * Host Config class
 * @extends classes.Config
 */
export class HostConfig extends classes.Config {
	get(name: "host.name"): string;
	get(name: "host.id"): number;
	get(name: "host.factorio_directory"): string;
	get(name: "host.mods_directory"): string;
	get(name: "host.mods_directory_is_shared"): boolean;
	get(name: "host.instances_directory"): string;
	get(name: "host.controller_url"): string;
	get(name: "host.controller_token"): string;
	get(name: "host.tls_ca"): string | null;
	get(name: "host.public_address"): string;
	get(name: "host.max_reconnect_delay"): number;
	get(name: string): unknown;
	get(name: string) { 
		return super.get(name);
	}
}
HostConfig.registerGroup(HostGroup);


/**
 * Instance config group for {@link classes.InstanceConfig}
 * @extends classes.ConfigGroup
 */
export class InstanceGroup extends classes.ConfigGroup { }
InstanceGroup.defaultAccess = ["controller", "host", "control"];
InstanceGroup.groupName = "instance";
InstanceGroup.define({
	name: "name",
	type: "string",
	initial_value: "New Instance",
});
InstanceGroup.define({
	name: "id",
	description: "ID of the instance",
	type: "number",
	initial_value: () => Math.random() * 2**31 | 0,
});
InstanceGroup.define({
	name: "assigned_host",
	type: "number",
	optional: true,
});
InstanceGroup.define({
	name: "auto_start",
	description: "Automatically start this instance when the host hosting it is started up",
	type: "boolean",
	initial_value: false,
});
InstanceGroup.finalize();

/**
 * Factorio config group for {@link classes.InstanceConfig}
 * @extends classes.ConfigGroup
 */
export class FactorioGroup extends classes.ConfigGroup { }
FactorioGroup.defaultAccess = ["controller", "host", "control"];
FactorioGroup.groupName = "factorio";
FactorioGroup.define({
	name: "version",
	description: "Version of the game to run, use latest to run the latest installed version",
	restartRequired: true,
	type: "string",
	initial_value: "latest",
});
FactorioGroup.define({
	name: "game_port",
	description: "UDP port to run game on, uses a random port if null",
	restartRequired: true,
	type: "number",
	optional: true,
});
FactorioGroup.define({
	name: "rcon_port",
	description: "TCP port to run RCON on, uses a random port if null",
	restartRequired: true,
	type: "number",
	optional: true,
});
FactorioGroup.define({
	name: "rcon_password",
	description: "Password for RCON, randomly generated if null",
	restartRequired: true,
	type: "string",
	optional: true,
});
FactorioGroup.define({
	name: "player_online_autosave_slots",
	description:
		"Rename autosaves where players have been online since the previous autosave into a separate autosave " +
		"pool with this many slots. Requires autosaves to be enabled to work. Set to 0 to disable.",
	type: "number",
	initial_value: 5,
});
FactorioGroup.define({
	name: "mod_pack",
	description: "Mod pack to use on this server",
	restartRequired: true,
	type: "number",
	optional: true,
});
FactorioGroup.define({
	name: "enable_save_patching",
	description: "Patch saves with Lua code. Required for Clusterio integrations, lua modules, and most plugins.",
	restartRequired: true,
	type: "boolean",
	initial_value: true,
});
FactorioGroup.define({
	name: "enable_whitelist",
	description: "Turn on whitelist for joining the server.",
	type: "boolean",
	initial_value: false,
});
FactorioGroup.define({
	name: "enable_authserver_bans",
	description: "Turn on Factorio.com based multiplayer bans.",
	restartRequired: true,
	type: "boolean",
	initial_value: false,
});
FactorioGroup.define({
	name: "settings",
	description: "Settings overridden in server-settings.json",
	restartRequired: true,
	restartRequiredProps: [
		"afk_autokick_interval", "allow_commands", "autosave_interval", "autosave_only_on_server", "description",
		"ignore_player_limit_for_returning_players", "max_players", "max_upload_slots",
		"max_upload_in_kilobytes_per_second", "name", "only_admins_can_pause_the_game", "game_password",
		"require_user_verification", "tags", "visibility",
	],
	type: "object",
	initial_value: {}, // See create instance handler in controller.
});
FactorioGroup.define({
	name: "verbose_logging",
	description: "Enable verbose logging on the Factorio server",
	restartRequired: true,
	type: "boolean",
	initial_value: false,
});
FactorioGroup.define({
	name: "strip_paths",
	description: "Strip down instance paths in the log",
	restartRequired: true,
	type: "boolean",
	initial_value: true,
});
FactorioGroup.define({
	name: "sync_adminlist",
	description: "Synchronize adminlist with controller",
	type: "boolean",
	initial_value: true,
});
FactorioGroup.define({
	name: "sync_whitelist",
	description: "Synchronize whitelist with controller",
	type: "boolean",
	initial_value: true,
});
FactorioGroup.define({
	name: "sync_banlist",
	description: "Synchronize banlist with controller",
	type: "boolean",
	initial_value: true,
});
FactorioGroup.define({
	name: "max_concurrent_commands",
	description: "Maximum number of RCON commands trasmitted in parallel",
	restartRequired: true,
	type: "number",
	initial_value: 5,
});
FactorioGroup.finalize();

/**
 * Instance config class
 * @extends classes.Config
 */
export class InstanceConfig extends classes.Config {
	get(name: "instance.name"): string;
	get(name: "instance.id"): number;
	get(name: "instance.assigned_host"): number | null;
	get(name: "instance.auto_start"): boolean;

	get(name: "factorio.version"): string;
	get(name: "factorio.game_port"): number | null;
	get(name: "factorio.rcon_port"): number | null;
	get(name: "factorio.rcon_password"): string | null;
	get(name: "factorio.player_online_autosave_slots"): number;
	get(name: "factorio.mod_pack"): number | null;
	get(name: "factorio.enable_save_patching"): boolean;
	get(name: "factorio.enable_whitelist"): boolean;
	get(name: "factorio.enable_authserver_bans"): boolean;
	get(name: "factorio.settings"): Record<string, unknown>;
	get(name: "factorio.verbose_logging"): boolean;
	get(name: "factorio.strip_paths"): boolean;
	get(name: "factorio.sync_adminlist"): boolean;
	get(name: "factorio.sync_whitelist"): boolean;
	get(name: "factorio.sync_banlist"): boolean;
	get(name: "factorio.max_concurrent_commands"): number;
	get(name: string): unknown;
	get(name: string) {
		return super.get(name);
	}
}
InstanceConfig.registerGroup(InstanceGroup);
InstanceConfig.registerGroup(FactorioGroup);


/**
 * Control config group for {@link classes.ControlConfig}
 * @extends classes.ConfigGroup
 */
export class ControlGroup extends classes.ConfigGroup {}
ControlGroup.defaultAccess = ["control"];
ControlGroup.groupName = "control";
ControlGroup.define({
	name: "controller_url",
	description: "URL to connect to the controller at",
	type: "string",
	optional: true,
});
ControlGroup.define({
	name: "controller_token",
	description: "Token to authenticate to controller with.",
	type: "string",
	optional: true,
});
ControlGroup.define({
	name: "tls_ca",
	description: "Path to Certificate Authority to validate TLS connection to controller against.",
	type: "string",
	optional: true,
});
ControlGroup.define({
	name: "max_reconnect_delay",
	title: "Max Reconnect Delay",
	description: "Maximum delay to wait before attempting to reconnect WebSocket",
	type: "number",
	initial_value: 60,
});
ControlGroup.finalize();

/**
 * Control config class
 * @extends classes.Config
 */
export class ControlConfig extends classes.Config { }
ControlConfig.registerGroup(ControlGroup);


function validateGroup(pluginInfo: PluginNodeEnvInfo|PluginWebpackEnvInfo, groupName: "ControllerConfigGroup"|"InstanceConfigGroup") {
	if (!(pluginInfo[groupName]?.prototype instanceof classes.PluginConfigGroup)) {
		throw new Error(
			`Expected ${groupName} for ${pluginInfo.name} to be a subclass of PluginConfigGroup`
		);
	}

	if (pluginInfo[groupName]?.groupName !== pluginInfo.name) {
		throw new Error(
			`Expected ${groupName} for ${pluginInfo.name} to be named after the plugin`
		);
	}
}

/**
 * Registers the config groups for the provided plugin infos
 *
 * @param {Array<Object>} pluginInfos - Array of plugin info objects.
 */
export function registerPluginConfigGroups(pluginInfos: PluginNodeEnvInfo[]|PluginWebpackEnvInfo[]) {
	for (let pluginInfo of pluginInfos) {
		if (pluginInfo.ControllerConfigGroup) {
			validateGroup(pluginInfo, "ControllerConfigGroup");
			ControllerConfig.registerGroup(pluginInfo.ControllerConfigGroup);

		} else {
			class ControllerConfigGroup extends classes.PluginConfigGroup { }
			ControllerConfigGroup.defaultAccess = ["controller", "host", "control"];
			ControllerConfigGroup.groupName = pluginInfo.name;
			ControllerConfigGroup.finalize();
			ControllerConfig.registerGroup(ControllerConfigGroup);
		}

		if (pluginInfo.instanceEntrypoint) {
			if (pluginInfo.InstanceConfigGroup) {
				validateGroup(pluginInfo, "InstanceConfigGroup");
				InstanceConfig.registerGroup(pluginInfo.InstanceConfigGroup);

			} else {
				class InstanceConfigGroup extends classes.PluginConfigGroup { }
				InstanceConfigGroup.defaultAccess = ["controller", "host", "control"];
				InstanceConfigGroup.groupName = pluginInfo.name;
				InstanceConfigGroup.finalize();
				InstanceConfig.registerGroup(InstanceConfigGroup);
			}
		}
	}
}

/**
 * Lock configs from adding more groups and make them usable
 */
export function finalizeConfigs() {
	ControllerConfig.finalize();
	HostConfig.finalize();
	InstanceConfig.finalize();
	ControlConfig.finalize();
}
