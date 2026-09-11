import { bootstrap } from "./ctl.js";
export * from "./ctl.js";
export { BaseCtlPlugin, CtlHooks, type CtlPluginContext } from "./src/BaseCtlPlugin.js";

if (import.meta.main) {
	bootstrap();
}
