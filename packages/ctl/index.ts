import { bootstrap } from "./ctl";
export * from "./ctl";
export { BaseCtlPlugin } from "./src/BaseCtlPlugin";

if (module === require.main) {
	bootstrap();
}
