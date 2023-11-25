/**
 * Plugin interfaces and utilities.
 * @module lib/plugin
 */
import * as libHelpers from "./helpers";
import type { PluginConfigGroup } from "./config";

// TODO Add proper typing for plugins
/* Used to define the export of info.ts from plugins */
export type PluginDeclaration = {
	name: string;
	title: string;
	description?: string;

	controllerEntrypoint?: string;
	ControllerConfigGroup?: typeof PluginConfigGroup;

	hostEntrypoint?: string;
	HostConfigGroup?: typeof PluginConfigGroup;

	instanceEntrypoint?: string;
	InstanceConfigGroup?: typeof PluginConfigGroup;

	ctlEntrypoint?: string;
	webEntrypoint?: string;
	ControlConfigGroup?: typeof PluginConfigGroup;

	messages?: any[];
	routes?: string[];
}

export type PluginNodeEnvInfo = PluginDeclaration & {
	requirePath: string;
	version: string;
	manifest: any;
};

export type PluginWebpackEnvInfo = PluginDeclaration & {
	container: any;
	package: any;
	enabled?: boolean;
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
export async function invokeHook(plugins: Map<string, any>, hook: string, ...args: any[]) {
	let results: unknown[] = [];
	for (let [name, plugin] of plugins) {
		try {
			// Use an object to detect if the hook failed on timeout or tried to return a value looking like an error
			const timeout = {};
			let result = await libHelpers.timeout(
				(plugin as any)[hook](...args),
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
