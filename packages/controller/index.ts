import { bootstrap } from "./controller";
export { default as Controller } from "./src/Controller";
export { default as ControlConnection } from "./src/ControlConnection";
export { default as InstanceInfo } from "./src/InstanceInfo";
export { default as BaseControllerPlugin } from "./src/BaseControllerPlugin";

if (module === require.main) {
	bootstrap();
}
