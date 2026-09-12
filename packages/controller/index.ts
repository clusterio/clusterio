import { bootstrap } from "./controller.js";
export { default as Controller } from "./src/Controller.js";
export { default as ControllerRouter } from "./src/ControllerRouter.js";
export { default as ControlConnection } from "./src/ControlConnection.js";
export { default as HostConnection } from "./src/HostConnection.js";
export { default as InstanceRecord } from "./src/InstanceRecord.js";
export { default as InstanceManager } from "./src/InstanceManager.js";
export { default as HostRecord } from "./src/HostRecord.js";
export { BaseControllerPlugin, ControllerHooks, type ControllerPluginContext } from "./src/BaseControllerPlugin.js";
export { default as UserManager } from "./src/UserManager.js";
export { default as UserRecord } from "./src/UserRecord.js";
export { default as User } from "./src/User.js";
export { default as WsServer } from "./src/WsServer.js";

if (import.meta.main) {
	bootstrap();
}
