import { bootstrap } from "./ctl.js";
export * from "./ctl.js";
export { CommandOutput, type OutputFormat } from "./src/command_ops.js";
export { BaseCtlPlugin, CtlHooks, type CtlPluginContext } from "./src/BaseCtlPlugin.js";

if (import.meta.main) {
	bootstrap();
}
