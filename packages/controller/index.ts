import { bootstrap } from "./controller.ts";
export { default as Controller } from "./src/Controller.ts";
export { default as ControllerRouter } from "./src/ControllerRouter.ts";
export { default as ControlConnection } from "./src/ControlConnection.ts";
export { default as HostConnection } from "./src/HostConnection.ts";
export { default as InstanceRecord } from "./src/InstanceRecord.ts";
export { default as InstanceManager } from "./src/InstanceManager.ts";
export { default as HostRecord } from "./src/HostRecord.ts";
export { default as BaseControllerPlugin } from "./src/BaseControllerPlugin.ts";
export { default as UserManager } from "./src/UserManager.ts";
export { default as UserRecord } from "./src/UserRecord.ts";
export { default as User } from "./src/User.ts";
export { default as WsServer } from "./src/WsServer.ts";

if (import.meta.main) {
	bootstrap();
}
