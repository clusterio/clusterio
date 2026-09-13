import { bootstrap } from "./ctl.ts";
export * from "./ctl.ts";
export { default as BaseCtlPlugin } from "./src/BaseCtlPlugin.ts";

if (import.meta.main) {
	bootstrap();
}
