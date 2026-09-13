import { bootstrap } from "./host.ts";
export { default as BaseHostPlugin } from "./src/BaseHostPlugin.ts";
export { default as BaseInstancePlugin } from "./src/BaseInstancePlugin.ts";
export { default as Host, HostRouter } from "./src/Host.ts";
export { default as Instance } from "./src/Instance.ts";
export { default as InstanceConnection } from "./src/InstanceConnection.ts";

if (import.meta.main) {
	bootstrap();
}
