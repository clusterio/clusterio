import type { PluginWebApi } from "@clusterio/lib";

/**
 * Canonical key for a set of plugins loaded on the controller
 *
 * @param plugins - name to version mapping of loaded plugins.
 * @returns value comparable with === against another key.
 */
export function pluginSetKey(plugins: Record<string, string>) {
	return JSON.stringify(Object.entries(plugins).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Canonical key for the plugins loaded when this page was started
 *
 * @param pluginList - plugin list as served by /api/plugins.
 * @returns value comparable with === against a key from the handshake.
 */
export function loadedPluginSetKey(pluginList: PluginWebApi[]) {
	// The handshake reports the plugins the controller is running, so
	// compare against loaded rather than enabled, which also takes the
	// config into account and only applies from the next restart.
	return pluginSetKey(Object.fromEntries(
		pluginList.filter(plugin => plugin.loaded).map(plugin => [plugin.name, plugin.version])
	));
}
