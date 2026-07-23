import type { PluginWebApi } from "@clusterio/lib";

/**
 * Fetch the set of plugins the controller is currently serving
 *
 * @returns plugin list as reported by the controller.
 * @throws Error if the controller did not answer with a plugin list.
 */
export async function fetchPluginSet(): Promise<PluginWebApi[]> {
	const response = await fetch(`${webRoot}api/plugins`);
	if (!response.ok) {
		throw new Error(`Plugin list request failed: ${response.status} ${response.statusText}`);
	}
	return await response.json();
}

/**
 * Summarise a plugin set as a comparable value
 *
 * Produces a value that differs whenever the web interface would have
 * loaded something else had it been started against this plugin set: a
 * plugin appearing or disappearing, being enabled or disabled, or its
 * code changing.  The entry point is included because it is content
 * hashed, so it also covers a plugin being updated in place without its
 * version changing.
 *
 * The web interface loads plugin code, registers their messages and adds
 * their config fields once during startup and has no way to undo any of
 * it, so a change here can only be resolved by reloading the page.
 *
 * @param plugins - plugin set to summarise.
 * @returns value comparable with === against another summary.
 */
export function pluginSetFingerprint(plugins: PluginWebApi[]) {
	return JSON.stringify(
		plugins
			.map(plugin => [plugin.name, plugin.version, plugin.enabled, plugin.web.main ?? null])
			.sort((a, b) => String(a[0]).localeCompare(String(b[0])))
	);
}
