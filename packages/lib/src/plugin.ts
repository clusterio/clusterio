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

export type PluginLoadContext<Context extends object> = Context & {
	logger: Logger;
	plugin: PluginNodeEnvInfo;
};

export type PluginClass<
	Context extends object,
	Instance = unknown
> = {
	new (...args: any[]): Instance,
	fromContext(context: PluginLoadContext<Context>): Instance & {
		init(): void;
	};
};

type PluginType = Extract<keyof PluginNodeEnvInfo, `${string}Entrypoint`> extends `${infer P}Entrypoint` ? P : never;

async function loadPluginEntrypoint<
	Context extends object
> (
	pluginInfo: PluginNodeEnvInfo,
	pluginType: PluginType,
	context: PluginLoadContext<Context>,
	module: Record<string, unknown>,
) {
	const init = module.default;

	if (typeof init !== "function") {
		throw new Error(`Expected ${pluginType} plugin ${pluginInfo.name} to export a default function`);
	}

	await init(context);
}

async function loadPluginClass<
	Context extends object,
	Class extends PluginClass<Context>,
> (
	pluginInfo: PluginNodeEnvInfo,
	pluginType: PluginType,
	context: PluginLoadContext<Context>,
	module: Record<string, unknown>,
	exportName: string,
	baseClass: Class,
) {
	const PluginClass = module[exportName] as any;

	if (typeof PluginClass !== "object") {
		throw new Error(`Expected ${pluginType} plugin ${pluginInfo.name} to export a class named ${exportName}`);
	}

	if (!(PluginClass.prototype instanceof baseClass)) {
		throw new Error(`Expected ${exportName} exported from ${pluginInfo.name} to extend ${baseClass.name}`);
	}

	await PluginClass.fromContext(context).init();
}

export async function loadPlugin<
	Context extends { logger: Logger },
	Class extends PluginClass<Context>,
> (
	pluginInfo: PluginNodeEnvInfo,
	pluginType: PluginType,
	context: Context,
	exportName: string,
	baseClass: Class,
) {
	const entrypoint = `${pluginType}Entrypoint` as const;
	const requirePath = pluginInfo[entrypoint];

	if (!requirePath) {
		return;
	}

	const module = require(requirePath);
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
	if (module[entrypoint]) {
		logger.warn(`Plugin ${pluginInfo.name} is using deprecated class hooks on ${pluginType}`);
		await loadPluginClass(pluginInfo, pluginType, pluginContext, module, exportName, baseClass);
		return;
	}

	throw new Error(`Plugin ${pluginInfo.name} must export either a default function or ${pluginType}`);
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
