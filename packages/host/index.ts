import { bootstrap } from "./host";
export { BaseHostPlugin, HostHooks, type HostPluginContext } from "./src/BaseHostPlugin";
export { BaseInstancePlugin, InstanceHooks, type InstancePluginContext } from "./src/BaseInstancePlugin";
export { default as Host, HostRouter } from "./src/Host";
export { default as Instance } from "./src/Instance";
export { default as InstanceConnection } from "./src/InstanceConnection";

if (module === require.main) {
	bootstrap();
}
