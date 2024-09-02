// Core definitions for the configuration system
import * as classes from "./classes";
import type { PluginNodeEnvInfo, PluginWebpackEnvInfo } from "../plugin";


export interface ControllerConfigFields {
	"controller.name": string;
	"controller.mods_directory": string;
	"controller.database_directory": string;
	"controller.http_port": number | null;
	"controller.https_port": number | null;
	"controller.bind_address": string | null;
	"controller.trusted_proxies": string | null;
	"controller.external_address": string | null;
	"controller.tls_certificate": string | null;
	"controller.tls_private_key": string | null;
	"controller.auth_secret": string;
	"controller.heartbeat_interval": number;
	"controller.session_timeout": number;
	"controller.metrics_timeout": number;
	"controller.system_metrics_interval": number;
	"controller.proxy_stream_timeout": number;
	"controller.default_mod_pack_id": number | null;
	"controller.default_role_id": number | null;
	"controller.autosave_interval": number;
}

/**
 * Controller Config class
 * @extends classes.Config
 */
export class ControllerConfig extends classes.Config<ControllerConfigFields> {
	declare static fromJSON: (json: classes.ConfigSchema, location: classes.ConfigLocation) => ControllerConfig;
	static fieldDefinitions: classes.ConfigDefs<ControllerConfigFields> = {
		"controller.name": {
			title: "Name",
			description: "Name of the cluster.",
			type: "string",
			initialValue: "Your Cluster",
		},
		"controller.mods_directory": {
			title: "Mods Directory",
			description: "Path to directory where mods shared with the cluster are stored.",
			restartRequired: true,
			type: "string",
			initialValue: "mods",
		},
		"controller.database_directory": {
			title: "Database directory",
			description: "Directory where item and configuration data is stored.",
			type: "string",
			initialValue: "database",
		},
		"controller.autosave_interval": {
			title: "Autosave Interval",
			description: "Interval in seconds to autosave data in memory to disk.",
			type: "number",
			initialValue: 60,
		},
		"controller.http_port": {
			title: "HTTP Port",
			description: "Port to listen for HTTP connections on, set to null to not listen for HTTP connections.",
			restartRequired: true,
			type: "number",
			optional: true,
			initialValue: 8080,
		},
		"controller.https_port": {
			title: "HTTPS Port",
			description: "Port to listen for HTTPS connection on, set to null to not listen for HTTPS connections.",
			restartRequired: true,
			type: "number",
			optional: true,
		},
		"controller.bind_address": {
			title: "Bind Address",
			description: "IP address to bind the HTTP and HTTPS ports on.",
			restartRequired: true,
			type: "string",
			optional: true,
		},
		"controller.trusted_proxies": {
			title: "Trusted Proxies",
			description:
				"Comma separated list of IP addresses and/or CIDR blocks to trust the X-Forwarded-For header on",
			type: "string",
			optional: true,
		},
		"controller.external_address": {
			title: "External Address",
			description: "Public facing address the controller is hosted on.",
			type: "string",
			optional: true,
		},
		"controller.tls_certificate": {
			title: "TLS Certificate",
			description: "Path to the certificate to use for HTTPS.",
			restartRequired: true,
			type: "string",
			optional: true,
		},
		"controller.tls_private_key": {
			title: "TLS Private Key",
			description: "Path to the private key to use for HTTPS.",
			restartRequired: true,
			type: "string",
			optional: true,
		},
		"controller.auth_secret": {
			access: ["controller"],
			title: "Controller Authentication Secret",
			description:
				"Secret used to generate and verify authentication tokens.  " +
				"Should be a long string of random letters and numbers.  " +
				"Do not share this.",
			restartRequired: true,
			type: "string",
			optional: true,
		},
		"controller.heartbeat_interval": {
			title: "Heartbeat Interval",
			description: "Interval heartbeats are sent out on WebSocket connections.",
			type: "number",
			initialValue: 15,
		},
		"controller.session_timeout": {
			title: "Session Timeout",
			description: "Time in seconds before giving up resuming a dropped WebSocket session.",
			type: "number",
			initialValue: 60,
		},
		"controller.metrics_timeout": {
			title: "Metrics Timeout",
			description: "Timeout in seconds for metrics gathering from hosts.",
			type: "number",
			initialValue: 8,
		},
		"controller.system_metrics_interval": {
			title: "System Metrics Interval",
			description: "Interval in seconds to collect and update system metrics for the Web UI",
			type: "number",
			initialValue: 10,
		},
		"controller.proxy_stream_timeout": {
			title: "Proxy Stream Timeout",
			description: "Timeout in seconds for proxy streams to start flowing.",
			type: "number",
			initialValue: 15,
		},
		"controller.default_mod_pack_id": {
			title: "Default Mod Pack",
			description: "Mod pack used by default for instances.",
			inputComponent: "mod_pack",
			type: "number",
			optional: true,
		},
		"controller.default_role_id": {
			title: "Default role",
			description: "ID of role assigned by default to new users.",
			type: "number",
			optional: true,
			initialValue: 1,
		},
	};
}

export interface HostConfigFields {
	"host.name": string;
	"host.id": number;
	"host.factorio_directory": string;
	"host.mods_directory": string;
	"host.instances_directory": string;
	"host.controller_url": string;
	"host.controller_token": string;
	"host.tls_ca": string | null;
	"host.public_address": string;
	"host.factorio_port_range": string;
	"host.max_reconnect_delay": number;
}

/**
 * Host Config class
 * @extends classes.Config
 */
export class HostConfig extends classes.Config<HostConfigFields> {
	declare static fromJSON: (json: classes.ConfigSchema, location: classes.ConfigLocation) => HostConfig;
	static fieldDefinitions: classes.ConfigDefs<HostConfigFields> = {
		"host.name": {
			description: "Name of the host",
			type: "string",
			initialValue: "New Host",
		},
		"host.id": {
			description: "ID of the host",
			type: "number",
			initialValue: () => Math.random() * 2**31 | 0,
		},
		"host.factorio_directory": {
			description: "Path to directory to look for factorio installs",
			type: "string",
			initialValue: "factorio",
		},
		"host.mods_directory": {
			title: "Mods Directory",
			description: "Path to directory where mods for instances are cached.",
			restartRequired: true,
			type: "string",
			initialValue: "mods",
		},
		"host.instances_directory": {
			description: "Path to directory to store instances in.",
			restartRequired: true,
			type: "string",
			initialValue: "instances",
		},
		"host.controller_url": {
			description: "URL to connect to the controller at",
			restartRequired: true,
			type: "string",
			initialValue: "http://localhost:8080/",
		},
		"host.controller_token": {
			access: ["host"],
			description: "Token to authenticate to controller with.",
			restartRequired: true,
			type: "string",
			initialValue: "enter token here",
		},
		"host.tls_ca": {
			description: "Path to Certificate Authority to validate TLS connection to controller against.",
			restartRequired: true,
			type: "string",
			optional: true,
		},
		"host.public_address": {
			description: "Public facing address players should connect to in order to join instances on this host",
			type: "string",
			initialValue: "localhost",
		},
		"host.factorio_port_range": {
			title: "Factorio port range",
			description:
				"Range of UDP ports to use for game connections. Supports both comma separated values and " +
				"ranges separated with a dash.",
			type: "string",
			initialValue: "34100-34199",
		},
		"host.max_reconnect_delay": {
			title: "Max Reconnect Delay",
			description: "Maximum delay to wait before attempting to reconnect WebSocket",
			type: "number",
			initialValue: 60,
		},
	};
}

export interface InstanceConfigFields {
	"instance.name": string;
	"instance.id": number;
	"instance.assigned_host": number | null;
	"instance.auto_start": boolean;

	"factorio.version": string;
	"factorio.executable_path": string | null;
	"factorio.game_port": number | null;
	"factorio.host_assigned_game_port": number | null;
	"factorio.rcon_port": number | null;
	"factorio.rcon_password": string | null;
	"factorio.player_online_autosave_slots": number;
	"factorio.mod_pack_id": number | null;
	"factorio.enable_save_patching": boolean;
	"factorio.enable_whitelist": boolean;
	"factorio.enable_authserver_bans": boolean;
	"factorio.settings": Record<string, unknown>;
	"factorio.verbose_logging": boolean;
	"factorio.strip_paths": boolean;
	"factorio.sync_adminlist": boolean;
	"factorio.sync_whitelist": boolean;
	"factorio.sync_banlist": boolean;
	"factorio.max_concurrent_commands": number;
}


/**
 * Instance config class
 * @extends classes.Config
 */
export class InstanceConfig extends classes.Config<InstanceConfigFields> {
	declare static fromJSON: (json: classes.ConfigSchema, location: classes.ConfigLocation) => InstanceConfig;
	static fieldDefinitions: classes.ConfigDefs<InstanceConfigFields> = {
		"instance.name": {
			type: "string",
			initialValue: "New Instance",
		},
		"instance.id": {
			description: "ID of the instance",
			type: "number",
			initialValue: () => Math.random() * 2**31 | 0,
		},
		"instance.assigned_host": {
			type: "number",
			optional: true,
		},
		"instance.auto_start": {
			description: "Automatically start this instance when the host hosting it is started up",
			type: "boolean",
			initialValue: false,
		},
		"factorio.version": {
			description: "Version of the game to run, use latest to run the latest installed version",
			restartRequired: true,
			type: "string",
			initialValue: "latest",
		},
		"factorio.executable_path": {
			description:
				"Relative path from the Factorio installation directory to the executable to run. " +
				"Defaults to auto detect the path, only needed in special setups.",
			restartRequired: true,
			type: "string",
			optional: true,
		},
		"factorio.game_port": {
			description: "UDP port to run game on, uses a port in host.factorio_port_range if null",
			restartRequired: true,
			type: "number",
			optional: true,
		},
		"factorio.host_assigned_game_port": {
			access: ["host"],
			type: "number",
			optional: true,
		},
		"factorio.rcon_port": {
			description: "TCP port to run RCON on, uses a random port if null",
			restartRequired: true,
			type: "number",
			optional: true,
		},
		"factorio.rcon_password": {
			description: "Password for RCON, randomly generated if null",
			restartRequired: true,
			type: "string",
			optional: true,
		},
		"factorio.player_online_autosave_slots": {
			description:
				"Rename autosaves where players have been online since the previous autosave into a separate " +
				"autosave pool with this many slots. Requires autosaves to be enabled to work. Set to 0 to disable.",
			type: "number",
			initialValue: 5,
		},
		"factorio.mod_pack_id": {
			title: "Mod Pack",
			description:
				"Mod pack to use on this server, if not set the default configured on the controller will be used",
			inputComponent: "mod_pack",
			restartRequired: true,
			type: "number",
			optional: true,
		},
		"factorio.enable_save_patching": {
			description:
				"Patch saves with Lua code. Required for Clusterio integrations, lua modules, and most plugins.",
			restartRequired: true,
			type: "boolean",
			initialValue: true,
		},
		"factorio.enable_whitelist": {
			description: "Turn on whitelist for joining the server.",
			type: "boolean",
			initialValue: false,
		},
		"factorio.enable_authserver_bans": {
			description: "Turn on Factorio.com based multiplayer bans.",
			restartRequired: true,
			type: "boolean",
			initialValue: false,
		},
		"factorio.settings": {
			description: "Settings overridden in server-settings.json",
			restartRequired: true,
			restartRequiredProps: [
				"afk_autokick_interval", "allow_commands", "autosave_interval", "autosave_only_on_server",
				"description", "ignore_player_limit_for_returning_players", "max_players", "max_upload_slots",
				"max_upload_in_kilobytes_per_second", "name", "only_admins_can_pause_the_game", "game_password",
				"require_user_verification", "tags", "visibility",
			],
			type: "object",
			initialValue: {}, // See create instance handler in controller.
		},
		"factorio.verbose_logging": {
			description: "Enable verbose logging on the Factorio server",
			restartRequired: true,
			type: "boolean",
			initialValue: false,
		},
		"factorio.strip_paths": {
			description: "Strip down instance paths in the log",
			restartRequired: true,
			type: "boolean",
			initialValue: true,
		},
		"factorio.sync_adminlist": {
			description: "Synchronize adminlist with controller",
			type: "boolean",
			initialValue: true,
		},
		"factorio.sync_whitelist": {
			description: "Synchronize whitelist with controller",
			type: "boolean",
			initialValue: true,
		},
		"factorio.sync_banlist": {
			description: "Synchronize banlist with controller",
			type: "boolean",
			initialValue: true,
		},
		"factorio.max_concurrent_commands": {
			description: "Maximum number of RCON commands trasmitted in parallel",
			restartRequired: true,
			type: "number",
			initialValue: 5,
		},
	};
}

export interface ControlConfigFields {
	"control.controller_url": string | null;
	"control.controller_token": string | null;
	"control.tls_ca": string | null;
	"control.max_reconnect_delay": number;
}

/**
 * Control config class
 * @extends classes.Config
 */
export class ControlConfig extends classes.Config<ControlConfigFields> {
	declare static fromJSON: (json: classes.ConfigSchema, location: classes.ConfigLocation) => ControlConfig;
	static fieldDefinitions: classes.ConfigDefs<ControlConfigFields> = {
		"control.controller_url": {
			description: "URL to connect to the controller at",
			type: "string",
			optional: true,
		},
		"control.controller_token": {
			access: ["control"],
			description: "Token to authenticate to controller with.",
			type: "string",
			optional: true,
		},
		"control.tls_ca": {
			description: "Path to Certificate Authority to validate TLS connection to controller against.",
			type: "string",
			optional: true,
		},
		"control.max_reconnect_delay": {
			title: "Max Reconnect Delay",
			description: "Maximum delay to wait before attempting to reconnect WebSocket",
			type: "number",
			initialValue: 60,
		},
	};
}


function validateFields(
	pluginName: string,
	fields: Record<string, classes.FieldDefinition>,
) {
	for (const [name, field] of Object.entries(fields)) {
		if (!name.startsWith(`${pluginName}.`)) {
			throw new Error(
				`Expected name of config field '${name}' for ${pluginName} to start with '${pluginName}.'`
			);
		}
	}
}

/**
 * Add config fields defined by the provided plugin infos
 *
 * @param {Array<Object>} pluginInfos - Array of plugin info objects.
 */
export function addPluginConfigFields(pluginInfos: PluginNodeEnvInfo[] | PluginWebpackEnvInfo[]) {
	function pluginConfig(
		pluginInfo: PluginNodeEnvInfo | PluginWebpackEnvInfo,
		kind: "controllerConfigFields" | "hostConfigFields" | "instanceConfigFields",
		Config: typeof ControllerConfig | typeof HostConfig | typeof InstanceConfig,
	) {
		(Config.fieldDefinitions as any)[`${pluginInfo.name}.load_plugin`] = {
			title: "Load Plugin",
			restartRequired: true,
			type: "boolean",
			initialValue: true,
		};

		const fields = pluginInfo[kind];
		if (fields) {
			validateFields(pluginInfo.name, fields);
			Object.assign(Config.fieldDefinitions, fields);
		}
	}
	for (let pluginInfo of pluginInfos) {
		pluginConfig(pluginInfo, "controllerConfigFields", ControllerConfig);
		if (pluginInfo.hostEntrypoint || pluginInfo.instanceEntrypoint) {
			pluginConfig(pluginInfo, "hostConfigFields", HostConfig);
		}
		if (pluginInfo.instanceEntrypoint) {
			pluginConfig(pluginInfo, "instanceConfigFields", InstanceConfig);
		}
	}
}
