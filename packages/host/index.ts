import { bootstrap } from "./host.js";
export { default as BaseHostPlugin } from "./src/BaseHostPlugin.js";
export { default as BaseInstancePlugin } from "./src/BaseInstancePlugin.js";
export { default as Host, HostRouter } from "./src/Host.js";
export { default as Instance } from "./src/Instance.js";
export { default as InstanceConnection } from "./src/InstanceConnection.js";

if (import.meta.main) {
	bootstrap();
}
