// Contained in its own file to allow use within web build
import type { PluginDeclaration, PluginType, PluginLoadContext, PluginClass } from "./plugin";


export async function loadPluginEntrypoint<
	Context extends object,
	Info extends PluginDeclaration
>(
	pluginInfo: Info,
	pluginType: PluginType,
	context: PluginLoadContext<Context, Info>,
	module: Record<string, unknown>
) {
	const init = module.default;

	if (typeof init !== "function") {
		throw new Error(`Expected ${pluginType} plugin ${pluginInfo.name} to export a default function`);
	}

	await init(context);
}

export async function loadPluginClass<
	Context extends object,
	Class extends PluginClass<Context, Info>,
	Info extends PluginDeclaration
>(
	pluginInfo: Info,
	pluginType: PluginType,
	context: PluginLoadContext<Context, Info>,
	module: Record<string, unknown>,
	exportName: string,
	baseClass: Class
) {
	const pluginClass = module[exportName];

	if (typeof pluginClass !== "function") {
		throw new Error(`Expected ${pluginType} plugin ${pluginInfo.name} to export a class named ${exportName}`);
	}

	if (!(pluginClass.prototype instanceof baseClass)) {
		throw new Error(`Expected ${exportName} exported from ${pluginInfo.name} to extend ${baseClass.name}`);
	}

	const plugin = (pluginClass as Class).fromContext(context);
	await plugin.init();
	return plugin as InstanceType<Class>;
}
