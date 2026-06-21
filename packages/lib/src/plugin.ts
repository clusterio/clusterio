/**
 * Plugin interfaces and utilities.
 * @module lib/plugin
 */
import fs from "node:fs/promises";
import path from "path";

import * as libErrors from "./errors";
import { type Logger, logger } from "./logging";
import type { FieldDefinition } from "./config";
import type { PlayerStats } from "./data";
import { loadPluginEntrypoint, loadPluginClass } from "./loadPlugin";


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
	routes?: string[];
}

export type PluginNodeEnvInfo = PluginDeclaration & {
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
	new (...args: any[]): any,
	fromContext(context: PluginLoadContext<Context, Info>): {
		init(): Promise<void>;
	};
};

export type PluginType =
	Extract<keyof PluginDeclaration, `${string}Entrypoint`> extends `${infer P}Entrypoint` ? P : never;

export async function loadPlugin<
	Context extends { logger: Logger },
	Class extends PluginClass<Context, PluginNodeEnvInfo>,
> (
	pluginInfo: PluginNodeEnvInfo,
	pluginType: PluginType,
	context: Context,
	exportName: `${string}Plugin`,
	baseClass: Class,
) {
	const entrypoint = `${pluginType}Entrypoint` as const;
	const requirePath = pluginInfo[entrypoint];

	if (!requirePath) {
		return;
	}

	const module = require(path.posix.join(pluginInfo.requirePath, requirePath));
	const pluginContext: PluginLoadContext<Context> = {
		...context,
		plugin: pluginInfo,
		logger: context.logger.child({ plugin: pluginInfo.name }),
	};

	if (typeof module.default === "function") {
		await loadPluginEntrypoint(pluginInfo, pluginType, pluginContext, module);
		return;
	}

	// migrate: accept plugins which export classes
	if (module[exportName]) {
		logger.warn(`Plugin ${pluginInfo.name} is using deprecated class export`);
		await loadPluginClass(pluginInfo, pluginType, pluginContext, module, exportName, baseClass);
		return;
	}

	throw new Error(`Plugin ${pluginInfo.name} must export either a default function or ${exportName} class`);
}

/**
 * Load plugin information
 *
 * Loads plugin info modules for the paths to the given plugins.  Once
 * loaded the info modules will not be reloaded should this function be
 * called again.
 *
 * @param pluginList -
 *     Mapping of plugin name to require path for the plugins to load.
 * @returns Array of plugin info modules.
 */
export async function loadPluginInfos(pluginList: Map<string, string>) {
	let plugins: PluginNodeEnvInfo[] = [];
	for (let [pluginName, pluginPath] of pluginList) {
		let pluginInfo: PluginNodeEnvInfo;
		let pluginPackage: { name?: string, version: string, main?: string, private?: boolean };

		// Check if plugin path exists, otherwise remove it
		try {
			require.resolve(pluginPath);
		} catch {
			let errMsg = `Plugin path ${pluginPath} does not exist`;
			try {
				await fs.access(pluginPath, fs.constants.F_OK);
				errMsg = `Plugin path ${pluginPath} missing index or main file`;
			} catch {}
			logger.error(`${errMsg}, not loading ${pluginName}`);
			pluginList.delete(pluginName);
			continue;
		}

		try {
			pluginInfo = require(pluginPath).plugin;
			pluginPackage = require(path.posix.join(pluginPath, "package.json"));
		} catch (err: any) {
			if (err.code === "InstallationError") {
				throw err;
			}
			throw new libErrors.PluginError(pluginName, err);
		}

		if (typeof pluginInfo !== "object") {
			throw new libErrors.EnvironmentError(
				`Expected plugin at ${pluginPath} to export an object named 'plugin' but got ${typeof pluginInfo}`,
			);
		}

		if (pluginInfo.name !== pluginName) {
			throw new libErrors.EnvironmentError(
				`Expected plugin at ${pluginPath} to be named ${pluginName} but got ${pluginInfo.name}`
			);
		}

		// migrate: ignore incompatible old plugins
		if (pluginInfo.messages && !(pluginInfo.messages instanceof Array)) {
			logger.warn(`Ignoring incompatible pre alpha.14 plugin ${pluginName}`);
			continue;
		}

		pluginInfo.requirePath = pluginPath;
		pluginInfo.version = pluginPackage.version;
		pluginInfo.npmPackage = !pluginPackage.private && pluginPath === pluginPackage.name ? pluginPath : undefined;
		plugins.push(pluginInfo);
	}
	return plugins;
}
