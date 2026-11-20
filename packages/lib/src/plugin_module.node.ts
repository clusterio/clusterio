import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginDeclaration, PluginNodeEnvInfo } from "./plugin.js";

export default async function importPluginModule(
	pluginInfo: PluginDeclaration, entrypoint: string
): Promise<Record<string, any>> {
	const packagePath = (pluginInfo as PluginNodeEnvInfo).packagePath;
	return await import(pathToFileURL(path.join(path.dirname(packagePath), entrypoint)).href);
}
