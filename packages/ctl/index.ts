import { bootstrap } from "./ctl.js";
export * from "./ctl.js";
export { default as BaseCtlPlugin } from "./src/BaseCtlPlugin.js";

if (import.meta.main) {
	bootstrap();
}
