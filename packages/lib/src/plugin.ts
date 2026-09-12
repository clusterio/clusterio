/**
 * Plugin interfaces and utilities.
 * @module lib/plugin
 */
import type { Logger } from "./logging.js";
import type { FieldDefinition } from "./config/index.js";
import type { PermissionDefinition } from "./permissions.js";
import type { PlayerStats } from "./data/index.js";

export const PluginFeatureFlags = [
	/** The plugin requires module code to be patched into the save */
	"SavePatching",
	/** The plugin requires access to script commands over rcon */
	"ScriptCommands",
] as const;

/** Used to define the plugin export in plugins */
export type PluginDeclaration = {
	name: string;
	title: string;
	description?: string;

	controllerEntrypoint?: string;
	controllerConfigFields?: Record<string, FieldDefinition>;

	hostEntrypoint?: string;
	hostConfigFields?: Record<string, FieldDefinition>;

	instanceEntrypoint?: string;
	instanceConfigFields?: Record<string, FieldDefinition>;

	ctlEntrypoint?: string;
	webEntrypoint?: string;
	controlConfigFields?: Record<string, FieldDefinition>;

	features?: (typeof PluginFeatureFlags)[number][];

	messages?: any[];
	permissions?: PermissionDefinition[];
	routes?: string[];
}

/**
 * Check if a plugin is expected to ship a web build.
 *
 * Mirrors the rule used by the create tool: a web build is generated when the
 * plugin has a web or controller entrypoint or defines config fields.
 */
export function pluginNeedsWebBuild(info: PluginDeclaration) {
	return Boolean(
		info.webEntrypoint
		|| info.controllerEntrypoint
		|| info.controllerConfigFields
		|| info.hostConfigFields
		|| info.instanceConfigFields
		|| info.controlConfigFields
	);
}

export type PluginNodeEnvInfo = PluginDeclaration & {
	/**
	 * Path to the folder with the static files that should be hosted on the web
	 * server in order for the web interface to be able to load the plugin.
	 */
	webStaticPath: string;
	/**
	 * Absolute path to the package.json file for the plugin.
	 */
	packagePath: string;
	requirePath: string;
	version: string;
	manifest: any;
	/**
	 * NPM package this plugin is published as. Not present if the package
	 * is private or the path used to load it does not match the name of the
	 * package.
	 */
	npmPackage?: string;
};

export type PluginWebpackEnvInfo = PluginDeclaration & {
	container?: any;
	package?: any;
	enabled?: boolean;
	error?: string;
};

/**
 * Information about the event.
 */
export interface PlayerEvent {
	type: "join" | "leave" | "import" | "promote" | "demote" | "ban" | "unban" | "whitelisted" | "unwhitelisted";
	/** Name of the player that caused the event */
	name: string,
	/**
	 * Only present for type "leave" and "ban". Reason for player leaving the
	 * game, one of the possible reasons in defines.disconnect_reason
	 * or "server_quit" if the server exits while the player is online.
	 * When type is "ban" this is the reason given for the ban.
	 */
	reason?: string;
	/**
	 * Statistics recorded for this player on the instance this event
	 * originated from.
	 */
	stats: PlayerStats,
}

export type PluginLoadContext<
	Context extends object,
	Info extends PluginDeclaration = PluginNodeEnvInfo
> = Context & {
	logger: Logger;
	plugin: Info;
};

export type PluginClass<
	Context extends object,
	Info extends PluginDeclaration,
> = {
	new (...args: any[]): any;
	fromContext(context: PluginLoadContext<Context, Info>): {
		init(): Promise<void>;
		detachHooks(): void;
	};
};

export type PluginType =
	Extract<keyof PluginDeclaration, `${string}Entrypoint`> extends `${infer P}Entrypoint` ? P : never;
