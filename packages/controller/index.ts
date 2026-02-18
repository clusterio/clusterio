import { bootstrap } from "./controller";
export { default as Controller } from "./src/Controller";
export { default as ControllerRouter } from "./src/ControllerRouter";
export { default as ControlConnection } from "./src/ControlConnection";
export { default as HostConnection } from "./src/HostConnection";
export { default as InstanceRecord } from "./src/InstanceRecord";
export { default as HostRecord } from "./src/HostRecord";
export { default as BaseControllerPlugin } from "./src/BaseControllerPlugin";
export { default as UserManager } from "./src/UserManager";
export { default as UserRecord } from "./src/UserRecord";
export { default as User } from "./src/User";
export { default as WsServer } from "./src/WsServer";

if (module === require.main) {
	bootstrap();
}
