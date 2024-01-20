/**
 * Plugin interfaces and utilities.
 * @module lib/plugin
 */
import * as libHelpers from "./helpers";
import type { Logger } from "./logging";
import type { FieldDefinition } from "./config";
import type { PlayerStats } from "./data";

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
	type: "join" | "leave" | "import";
	/** Name of the player that joined/left */
	name: string,
	/**
	 * Only present for type "leave". Reason for player leaving the
	 * game, one of the possible reasons in defines.disconnect_reason
	 * or "server_quit" if the server exits while the player is online.
	 */
	reason?: string;
	/**
	 * Statistics recorded for this player on the instance this event
	 * originated from.
	 */
	stats: PlayerStats,
}

/**
 * Invokes the given hook on all plugins
 *
 * @param plugins -
 *     Mapping of plugin names to plugins to invoke the hook on.
 * @param hook - Name of hook to invoke.
 * @param args - Arguments to pass on to the hook.
 * @returns Non-undefined return values from the hooks.
 */
export async function invokeHook<
	Hook extends string,
	R,
	Args extends [...any],
	Plugin extends { logger: Logger } & Record<Hook, (...hookArgs: Args) => R | Promise<R>>
>(
	plugins: Map<string, Plugin>,
	hook: Hook,
	...args: Args
): Promise<Exclude<Awaited<ReturnType<Plugin[Hook]>>, void>[]> {
	let results: any[] = [];
	for (let [name, plugin] of plugins) {
		try {
			const timeout = Symbol("timeout-token");
			let result = await libHelpers.timeout<R | typeof timeout>(
				plugin[hook](...args) as Promise<R>,
				15000,
				timeout
			);
			if (result === timeout) {
				throw new Error(`Invoking hook ${hook} timed out for plugin ${name}`);
			} else if (result !== undefined) {
				results.push(result);
			}
		} catch (err: any) {
			plugin.logger.error(`Ignoring error from plugin ${name} in ${hook}:\n${err.stack}`);
		}
	}
	return results;
}
