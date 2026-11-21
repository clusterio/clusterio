/**
 * Plugin interfaces and utilities.
 * @module lib/plugin
 */
import type { Static } from "@sinclair/typebox";
import type { Logger } from "./logging.js";
import type { ConfigSchema, FieldDefinition } from "./config/index.js";
import type { PermissionDefinition } from "./permissions.js";
import type { PlayerStats, Role } from "./data/index.js";
import type { SyncHook } from "./SyncHook.js";
import type { ErrorClass } from "./link/index.js";
import { ModDependency } from "./data/ModInfo.js";

export const PluginFeatureFlags = [
	/** The plugin requires module code to be patched into the save */
	"SavePatching",
	/** The plugin requires access to script commands over rcon */
	"ScriptCommands",
	/** The plugin requires UDP messaging with the Factorio server */
	"LuaUdp",
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
	ctlConfigFields?: Record<string, FieldDefinition>;

	migrationEntrypoint?: string;

	features?: (typeof PluginFeatureFlags)[number][];
	/**
	 * Factorio mods the plugin needs in the instance's mod pack, as Factorio
	 * dependency strings like `"subspace_storage >= 2.3.0"`.
	 */
	requiredMods?: string[];

	messages?: any[];
	errors?: ErrorClass[];
	permissions?: PermissionDefinition[];
	routes?: string[];
};

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
		|| info.ctlConfigFields
	);
}

/**
 * Parse the requiredMods of a plugin
 *
 * A mod listed more than once must satisfy every entry, which gives a range.
 *
 * @throws Error if an entry is invalid or has a dependency prefix.
 */
export function pluginRequiredMods(pluginInfo: PluginDeclaration) {
	return (pluginInfo.requiredMods ?? []).map(spec => {
		const dependency = new ModDependency(spec);
		if (dependency.type !== "required") {
			throw new Error(`requiredMods entry "${spec}" can not have a dependency prefix`);
		}
		return dependency;
	});
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
	/**
	 * Directory of an npm package providing a plugin with the same name
	 * that was skipped on startup as this plugin was already in the list.
	 */
	skippedNpmPackage?: string;
};

export type PluginWebEnvInfo = PluginDeclaration & {
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

/** Access to the other plugins loaded alongside a plugin */
export interface PluginRegistry {
	/**
	 * Wait for another plugin to load
	 *
	 * @param name - Name of the plugin to wait for.
	 * @param timeoutMs - Time to wait before giving up, defaults to 30 seconds.
	 * @returns
	 *     What the plugin's entrypoint returned, or undefined with a
	 *     warning logged if it did not load.
	 */
	waitFor<T = unknown>(name: string, timeoutMs?: number): Promise<T | undefined>;
	/** Check if a plugin is installed, it may still be disabled */
	checkInstalled(name: string): boolean;
	/** Check if a plugin is being loaded alongside this one */
	checkEnabled(name: string): boolean;
}

export type PluginLoadContext<
	Context extends object,
	Info extends PluginDeclaration = PluginNodeEnvInfo
> = Context & {
	logger: Logger;
	plugin: Info;
	plugins: PluginRegistry;
};

/** Hooks for migrating data that Clusterio stores on behalf of plugins */
export type MigrationHooks = {
	controllerConfig: SyncHook<ConfigSchema>;
	hostConfig: SyncHook<ConfigSchema>;
	instanceConfig: SyncHook<ConfigSchema>;
	role: SyncHook<Static<typeof Role.jsonSchema>>;
};

export type MigrationContext = PluginLoadContext<{ hooks: MigrationHooks }>;

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
