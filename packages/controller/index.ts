import { bootstrap } from "./controller";
export { default as Controller } from "./src/Controller";
export { default as ControllerRouter } from "./src/ControllerRouter";
export { default as ControlConnection } from "./src/ControlConnection";
export { default as HostConnection } from "./src/HostConnection";
export { default as InstanceInfo } from "./src/InstanceInfo";
export { default as HostInfo } from "./src/HostInfo";
export { default as BaseControllerPlugin } from "./src/BaseControllerPlugin";
export { default as UserManager } from "./src/UserManager";
export { default as UserView } from "./src/UserView";
export { default as WsServer } from "./src/WsServer";

if (module === require.main) {
	bootstrap();
}
