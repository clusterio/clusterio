import { bootstrap } from "./host.js";
export { BaseHostPlugin, HostHooks, type HostPluginContext } from "./src/BaseHostPlugin.js";
export { BaseInstancePlugin, InstanceHooks, type InstancePluginContext } from "./src/BaseInstancePlugin.js";
export { default as Host, HostRouter } from "./src/Host.js";
export { default as Instance } from "./src/Instance.js";
export { default as InstanceConnection } from "./src/InstanceConnection.js";

if (import.meta.main) {
	bootstrap();
}
