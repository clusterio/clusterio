import { Type, Static } from "@sinclair/typebox";
import * as lib from "@clusterio/lib";

/** Instance shown in the server list of a lobby */
export class LobbyServer {
	constructor(
		public id: number,
		public name: string,
		public status: lib.InstanceStatus,
		/** Factorio version the instance runs, or null if not known */
		public version: string | null,
		public players: number,
	) {
	}

	static jsonSchema = Type.Object({
		"id": Type.Integer(),
		"name": Type.String(),
		"status": lib.InstanceStatus,
		"version": Type.Union([Type.String(), Type.Null()]),
		"players": Type.Integer(),
	});

	static fromJSON(json: Static<typeof LobbyServer.jsonSchema>): LobbyServer {
		return new this(json.id, json.name, json.status, json.version, json.players);
	}
}

export class ServerListRequest {
	declare ["constructor"]: typeof ServerListRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "lobby" as const;

	static Response = lib.jsonArray(LobbyServer);
}

export type TransferState = "starting" | "ready" | "failed";
const TransferStateSchema = Type.Union([Type.Literal("starting"), Type.Literal("ready"), Type.Literal("failed")]);

export class TransferStatus {
	constructor(
		public state: TransferState,
		/** Name of the instance transferred to */
		public name: string,
		/** Address to connect to when ready */
		public address?: string,
		/** Reason for a failed transfer */
		public message?: string,
	) {
	}

	static jsonSchema = Type.Object({
		"state": TransferStateSchema,
		"name": Type.String(),
		"address": Type.Optional(Type.String()),
		"message": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof TransferStatus.jsonSchema>): TransferStatus {
		return new this(json.state, json.name, json.address, json.message);
	}
}

/** Request from a lobby to send a player to an instance, starting it if needed */
export class TransferRequest {
	declare ["constructor"]: typeof TransferRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "lobby" as const;

	constructor(
		public player: string,
		public instanceId: number,
	) {
	}

	static jsonSchema = Type.Object({
		"player": Type.String(),
		"instanceId": Type.Integer(),
	});

	static fromJSON(json: Static<typeof TransferRequest.jsonSchema>): TransferRequest {
		return new this(json.player, json.instanceId);
	}

	static Response = TransferStatus;
}

/** Update on a transfer of a player sent to the lobby the player is on */
export class TransferStatusEvent {
	declare ["constructor"]: typeof TransferStatusEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "instance" as const;
	static plugin = "lobby" as const;

	constructor(
		public player: string,
		public instanceId: number,
		public status: TransferStatus,
	) {
	}

	static jsonSchema = Type.Object({
		"player": Type.String(),
		"instanceId": Type.Integer(),
		"status": TransferStatus.jsonSchema,
	});

	static fromJSON(json: Static<typeof TransferStatusEvent.jsonSchema>): TransferStatusEvent {
		return new this(json.player, json.instanceId, TransferStatus.fromJSON(json.status));
	}
}
