/**
 * Shared data types used in Clusterio
 * @module lib/data
 * @author Hornwitser
 */
export { default as ExportManifest } from "./ExportManifest";
export { default as ModInfo } from "./ModInfo";
export { default as ModPack } from "./ModPack";
export * from "./composites";
export * from "./messages_core";
export * from "./messages_controller";
export * from "./messages_host";
export * from "./messages_instance";
export * from "./messages_mod";
export * from "./messages_user";
export * from "./version";

// TODO: Remove/migrate after lib/data is migrated to ts
import type { User } from "../users";
export type AddressType = "controller" | "host" | "instance" | "control" | "broadcast";
export interface Serialisable {
	jsonSchema: object,
	fromJSON(json: any): object,
}

import type { Address } from "./messages_core";
export type AddressShorthand =
	| "controller"
	| { instanceId: number }
	| { hostId: number }
	| { controlId: number }
	| Address

export class Request {
	static type: "request";
	static src: AddressType | AddressType[];
	static dst: AddressType | AddressType[];
	static permission: null | "string" | ((user: User, message: Request) => void);
	static plugin?: string;
	static jsonSchema?: object;
	static fromJSON?: (json: any) => Request;
	static Response?: Serialisable;
}

export class Event {
	static type: "event";
	static src: AddressType | AddressType[];
	static dst: AddressType | AddressType[];
	static permission: null | "string" | ((user: User, message: Event) => void);
	static plugin?: string;
	static jsonSchema?: object;
	static fromJSON?: (json: any) => Event;
}
