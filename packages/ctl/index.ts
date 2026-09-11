import { bootstrap } from "./ctl";
export * from "./ctl";
export { BaseCtlPlugin, CtlHooks, type CtlPluginContext } from "./src/BaseCtlPlugin";

if (module === require.main) {
	bootstrap();
}
