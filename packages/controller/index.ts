import { bootstrap } from "./controller";
export { default as Controller } from "./src/Controller";
export { default as ControllerUser } from "./src/ControllerUser";
export { default as ControlConnection } from "./src/ControlConnection";
export { default as InstanceInfo } from "./src/InstanceInfo";
export { default as BaseControllerPlugin } from "./src/BaseControllerPlugin";
export { default as UserManager } from "./src/UserManager";

if (module === require.main) {
	bootstrap();
}
