// Note: Run compile_validator script after making changes to this file.
import { TSchema, Type, Static } from "@sinclair/typebox";
// eslint-disable-next-line node/no-missing-import
import messageValidate from "./message_validate"; // generated file
import { StringEnum } from "./composites";

export type AddressType = "controller" | "host" | "instance" | "control" | "broadcast";
export type AddressShorthand =
	| "controller"
	| "allHosts"
	| "allInstances"
	| "allControls"
	| { instanceId: number }
	| { hostId: number }
	| { controlId: number }
	| Address
;

export class Address {
	/** Controller address */
	static controller = 0;
	/** Instance address */
	static instance = 1;
	/** Host address */
	static host = 2;
	/** Control address */
	static control = 3;
	/** Broadcast */
	static broadcast = 4;

	constructor(
		public type: number,
		public id: number,
		public requestId?: number,
	) { }

	/**
	 * Convert from convenient shorthand notation to address.
	 *
	 * Supported notations and their corresponding address:
	 * - `"controller"`: new Address(Address.controller, 0)
	 * - `{ hostId: id }`: new Address(Address.host, id)
	 * - `{ instanceId: id }`: new Address(Address.instance, id)
	 * - `{ controlId: id }`: new Address(Address.control, id)
	 *   `"allHosts"`: new Address(Address.broadcast, Address.host)
	 *   `"allInstances"`: new Address(Address.broadcast, Address.instance)
	 *   `"allControls"`: new Address(Address.broadcast, Address.control)
	 * @param shorthand -
	 *     Shorthand to translate with.
	 * @returns Translated address.
	 */
	static fromShorthand(shorthand: AddressShorthand) {
		if (shorthand instanceof Address) { return shorthand; }
		if (shorthand === "controller") { return new Address(Address.controller, 0); }
		if (shorthand === "allHosts") { return new Address(Address.broadcast, Address.host); }
		if (shorthand === "allInstances") { return new Address(Address.broadcast, Address.instance); }
		if (shorthand === "allControls") { return new Address(Address.broadcast, Address.control); }
		let entries = Object.entries(shorthand);
		if (entries.length === 1) {
			let [name, value] = entries[0];
			if (name === "hostId") { return new Address(Address.host, value); }
			if (name === "instanceId") { return new Address(Address.instance, value); }
			if (name === "controlId") { return new Address(Address.control, value); }
		}
		throw Error("Unrecognized shorthand");
	}

	static jsonSchema = Type.Unsafe<[number, number, number?]>({
		type: "array",
		minItems: 2,
		items: [
			{ type: "integer", minimum: 0, maximum: 4 },
			Type.Integer(),
			Type.Integer(),
		],
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json[0], json[1], json[2]);
	}

	toJSON() {
		if (this.requestId !== undefined) {
			return [this.type, this.id, this.requestId];
		}
		return [this.type, this.id];
	}

	toString() {
		const typeMap = ["controller", "instance", "host", "control"];
		const type = typeMap[this.type] || this.type;
		if (this.type === Address.broadcast) {
			return `[Address ${type}:${typeMap[this.id] || this.id}]`;
		}
		if (this.requestId === undefined) {
			return `[Address ${type}:${this.id}]`;
		}
		return `[Address ${type}:${this.id}:${this.requestId}]`;
	}

	/**
	 * Returns a string suitable for indexing the address in a Map
	 * @returns unique string for this address
	 */
	index() {
		return `${this.type}:${this.id}:${this.requestId}`;
	}

	/**
	 * Returns true if this address targets the given destination
	 * @param dst - Destination to check
	 * @returns true if this address is addressed to the given destination
	 */
	addressedTo(dst: Address) {
		if (this.type !== Address.broadcast) {
			return (
				this.type === dst.type
				&& this.id === dst.id
			);
		}
		return dst.type !== Address.broadcast && this.id === dst.type;
	}

	equals(other: Address) {
		return (
			this.type === other.type
			&& this.id === other.id
			&& this.requestId === other.requestId
		);
	}
}

type MessageType =
	| "hello"
	| "registerHost"
	| "registerControl"
	| "ready"
	| "resume"
	| "continue"
	| "invalidate"
	| "heartbeat"
	| "request"
	| "response"
	| "responseError"
	| "event"
	| "disconnect"
;
export class Message {
	constructor(
		public type: MessageType,
	) { }

	static jsonSchema: TSchema;
	static validate = messageValidate;

	static fromJSON(json: any) {
		/* eslint-disable no-use-before-define */
		if (json.type === "hello") { return MessageHello.fromJSON(json); }
		if (json.type === "registerHost") { return MessageRegisterHost.fromJSON(json); }
		if (json.type === "registerControl") { return MessageRegisterControl.fromJSON(json); }
		if (json.type === "ready") { return MessageReady.fromJSON(json); }
		if (json.type === "resume") { return MessageResume.fromJSON(json); }
		if (json.type === "continue") { return MessageContinue.fromJSON(json); }
		if (json.type === "invalidate") { return MessageInvalidate.fromJSON(json); }
		if (json.type === "heartbeat") { return MessageHeartbeat.fromJSON(json); }
		if (json.type === "request") { return MessageRequest.fromJSON(json); }
		if (json.type === "response") { return MessageResponse.fromJSON(json); }
		if (json.type === "responseError") { return MessageResponseError.fromJSON(json); }
		if (json.type === "event") { return MessageEvent.fromJSON(json); }
		if (json.type === "disconnect") { return MessageDisconnect.fromJSON(json); }
		/* eslint-enable no-use-before-define */
		throw new Error(`Unrecognized message type ${json.type}`);
	}
}

export type MessageRoutable = MessageRequest | MessageResponse | MessageResponseError | MessageEvent;

export class HelloData {
	constructor(
		public version: string,
		public plugins: Record<string, string>,
	) { }

	static jsonSchema = Type.Object({
		"version": Type.String(),
		"plugins": Type.Record(Type.String(), Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.version, json.plugins);
	}
}

export class MessageHello extends Message {
	constructor(
		public data: HelloData,
	) {
		super("hello");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("hello"),
		"data": HelloData.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(HelloData.fromJSON(json.data));
	}
};

export class RegisterHostData {
	constructor(
		public token: string,
		public agent: string,
		public version: string,
		public name: string,
		public id: number,
		public publicAddress: string | undefined,
		public plugins: Record<string, string>,
	) { }

	static jsonSchema = Type.Object({
		"token": Type.String(),
		"agent": Type.String(),
		"version": Type.String(),
		"name": Type.String(),
		"id": Type.Integer(),
		"publicAddress": Type.Optional(Type.String()),
		"plugins": Type.Record(Type.String(), Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.token, json.agent, json.version, json.name, json.id, json.publicAddress, json.plugins);
	}
}

export class MessageRegisterHost extends Message {
	constructor(
		public data: RegisterHostData,
	) {
		super("registerHost");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("registerHost"),
		"data": RegisterHostData.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(RegisterHostData.fromJSON(json.data));
	}
};

export class RegisterControlData {
	constructor(
		public token: string,
		public agent: string,
		public version: string,
	) { }

	static jsonSchema = Type.Object({
		"token": Type.String(),
		"agent": Type.String(),
		"version": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.token, json.agent, json.version);
	}
}

export class MessageRegisterControl extends Message {
	constructor(
		public data: RegisterControlData,
	) {
		super("registerControl");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("registerControl"),
		"data": RegisterControlData.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(RegisterControlData.fromJSON(json.data));
	}
};

export type AccountRole = {
	name: string;
	id: number;
	permissions: string[];
};

export class AccountDetails {
	constructor(
		public name: string,
		public roles: AccountRole[],
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"roles": Type.Array(
			Type.Object({
				"name": Type.String(),
				"id": Type.Integer(),
				"permissions": Type.Array(Type.String()),
			}),
		),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.roles);
	}
}

export class ReadyData {
	constructor(
		public src: Address,
		public sessionToken: string,
		public sessionTimeout: number,
		public heartbeatInterval: number,
		public account?: AccountDetails,
	) { }

	static jsonSchema = Type.Object({
		"src": Address.jsonSchema,
		"sessionToken": Type.String(),
		"sessionTimeout": Type.Number(),
		"heartbeatInterval": Type.Number(),
		"account": Type.Optional(AccountDetails.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		let account: AccountDetails | undefined;
		if (json.account) { account = AccountDetails.fromJSON(json.account); }
		return new this(
			Address.fromJSON(json.src),
			json.sessionToken,
			json.sessionTimeout,
			json.heartbeatInterval,
			account
		);
	}
}

export class MessageReady extends Message {
	constructor(
		public data: ReadyData,
	) {
		super("ready");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("ready"),
		"data": ReadyData.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(ReadyData.fromJSON(json.data));
	}
}

export class ResumeData {
	constructor(
		public sessionToken: string,
		public lastSeq?: number,
	) { }

	static jsonSchema = Type.Object({
		"sessionToken": Type.String(),
		"lastSeq": Type.Optional(Type.Integer()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.sessionToken, json.lastSeq);
	}
}


export class MessageResume extends Message {
	constructor(
		public data: ResumeData,
	) {
		super("resume");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("resume"),
		"data": ResumeData.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(ResumeData.fromJSON(json.data));
	}
}

export class ContinueData {
	constructor(
		public sessionTimeout: number,
		public heartbeatInterval: number,
		public lastSeq?: number,
	) { }

	static jsonSchema = Type.Object({
		"sessionTimeout": Type.Number(),
		"heartbeatInterval": Type.Number(),
		"lastSeq": Type.Optional(Type.Integer()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.sessionTimeout, json.heartbeatInterval, json.lastSeq);
	}
}

export class MessageContinue extends Message {
	constructor(
		public data: ContinueData,
	) {
		super("continue");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("continue"),
		"data": ContinueData.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(ContinueData.fromJSON(json.data));
	}
}

export class MessageInvalidate extends Message {
	constructor() {
		super("invalidate");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("invalidate"),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this();
	}
}

export class MessageHeartbeat extends Message {
	constructor(
		public seq?: number,
	) {
		super("heartbeat");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("heartbeat"),
		"seq": Type.Optional(Type.Integer()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.seq);
	}
}

export class MessageRequest<T = unknown> extends Message {
	constructor(
		public seq: number,
		public src: Address,
		public dst: Address,
		public name: string,
		public data?: T,
	) {
		super("request");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("request"),
		"seq": Type.Integer(),
		"src": Address.jsonSchema,
		"dst": Address.jsonSchema,
		"name": Type.String(),
		"data": Type.Optional(Type.Unknown()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.seq,
			Address.fromJSON(json.src),
			Address.fromJSON(json.dst),
			json.name,
			json.data,
		);
	}
};

export class MessageResponse<T = unknown> extends Message {
	constructor(
		public seq: number,
		public src: Address,
		public dst: Address,
		public data?: T,
	) {
		super("response");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("response"),
		"seq": Type.Integer(),
		"src": Address.jsonSchema,
		"dst": Address.jsonSchema,
		"data": Type.Optional(Type.Unknown()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.seq,
			Address.fromJSON(json.src),
			Address.fromJSON(json.dst),
			json.data,
		);
	}
};

export class ResponseError {
	constructor(
		public message: string,
		public code?: string,
		public stack?: string,
	) { }

	static jsonSchema = Type.Object({
		"message": Type.String(),
		"code": Type.Optional(Type.String()),
		"stack": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.message, json.code, json.stack);
	}
}

export class MessageResponseError extends Message {
	constructor(
		public seq: number,
		public src: Address,
		public dst: Address,
		public data: ResponseError,
	) {
		super("responseError");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("responseError"),
		"seq": Type.Integer(),
		"src": Address.jsonSchema,
		"dst": Address.jsonSchema,
		"data": ResponseError.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.seq,
			Address.fromJSON(json.src),
			Address.fromJSON(json.dst),
			ResponseError.fromJSON(json.data),
		);
	}
};

export class MessageEvent<T = unknown> extends Message {
	constructor(
		public seq: number,
		public src: Address,
		public dst: Address,
		public name: string,
		public data?: T,
	) {
		super("event");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("event"),
		"seq": Type.Integer(),
		"src": Address.jsonSchema,
		"dst": Address.jsonSchema,
		"name": Type.String(),
		"data": Type.Optional(Type.Unknown()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.seq,
			Address.fromJSON(json.src),
			Address.fromJSON(json.dst),
			json.name,
			json.data,
		);
	}
};

export class MessageDisconnect extends Message {
	constructor(
		public data: string,
	) {
		super("disconnect");
	}

	static jsonSchema = Type.Object({
		"type": Type.Literal("disconnect"),
		"data": StringEnum(["prepare", "ready"]),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.data);
	}
};

Message.jsonSchema = Type.Union([
	MessageHello.jsonSchema,
	MessageRegisterHost.jsonSchema,
	MessageRegisterControl.jsonSchema,
	MessageReady.jsonSchema,
	MessageResume.jsonSchema,
	MessageContinue.jsonSchema,
	MessageInvalidate.jsonSchema,
	MessageHeartbeat.jsonSchema,
	MessageRequest.jsonSchema,
	MessageResponse.jsonSchema,
	MessageResponseError.jsonSchema,
	MessageEvent.jsonSchema,
	MessageDisconnect.jsonSchema,
]);

export class PingRequest {
	declare ["constructor"]: typeof PingRequest;
	static type = "request" as const;
	static src = ["controller", "host", "control"] as const;
	static dst = ["controller", "host", "control"] as const;
	static permission = null;
}

export class AccountUpdateEvent {
	declare ["constructor"]: typeof AccountUpdateEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;

	constructor(
		public roles?: AccountRole[],
	) { }

	static jsonSchema = Type.Object({
		roles: Type.Array(
			Type.Object({
				name: Type.String(),
				id: Type.Integer(),
				permissions: Type.Array(Type.String()),
			}),
		),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.roles);
	}
}
