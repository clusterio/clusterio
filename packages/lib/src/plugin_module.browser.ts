import type { PluginDeclaration, PluginWebEnvInfo } from "./plugin";

export default async function importPluginModule(
	pluginInfo: PluginDeclaration, entrypoint: string
): Promise<Record<string, any>> {
	return await (pluginInfo as PluginWebEnvInfo).container.get(entrypoint);
}
