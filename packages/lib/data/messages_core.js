"use strict";
const libSchema = require("../schema");


/** @memberof module:lib/data */
class Address {
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

	/** @type {number} */
	type;

	/** @type {string} */
	id;

	/** @type {string|undefined} */
	requestId;

	constructor(type, id, requestId) {
		if (typeof type !== "number") {
			throw Error(`Invalid type ${type}`);
		}
		this.type = type;
		this.id = id;
		this.requestId = requestId;
	}

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
	 * @param {module:lib/data.Address|string|object} shorthand -
	 *     Shorthand to translate with.
	 * @returns {module:lib/data.Address} Translated address.
	 */
	static fromShorthand(shorthand) {
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

	static jsonSchema = {
		type: "array",
		minItems: 2,
		maxItems: 3,
		items: [
			{ type: "integer", minimum: 0, maximum: 4 },
			{ type: "integer" },
			{ type: "integer" },
		],
	};

	static fromJSON(json) {
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
	 * Returns true if this address targets the given destination
	 * @param {module:lib/Data.Address} dst - Destination to check
	 * @returns {boolean} true if this address is addressed to the given destination
	 */
	addressedTo(dst) {
		if (this.type !== Address.broadcast) {
			return (
				this.type === dst.type
				&& this.id === dst.id
			);
		}
		return dst.type !== Address.broadcast && this.id === dst.type;
	}

	equals(other) {
		return (
			this.type === other.type
			&& this.id === other.id
			&& this.requestId === other.requestId
		);
	}
}

/** @memberof module:lib/data */
class Message {
	/** @type {string} */
	type;

	constructor(type) {
		this.type = type;
	}

	static jsonSchema;
	static validate;

	static fromJSON(json) {
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

/** @memberof module:lib/data */
class HelloData {
	/** @type {string} */
	version;
	/** @type {object} */
	plugins;

	constructor(version, plugins) {
		this.version = version;
		this.plugins = plugins;
	}

	static jsonSchema = {
		required: ["version", "plugins"],
		properties: {
			"version": { type: "string" },
			"plugins": {
				type: "object",
				additionalProperties: { type: "string" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.version, json.plugins);
	}
}

/** @memberof module:lib/data */
class MessageHello extends Message {
	/** @type {module:lib/data.HelloData} */
	data;

	constructor(data) {
		super("hello");
		this.data = data;
	}

	static jsonSchema = {
		type: "object",
		required: ["type", "data"],
		properties: {
			"type": { const: "hello" },
			"data": HelloData.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(HelloData.fromJSON(json.data));
	}
};

/** @memberof module:lib/data */
class RegisterHostData {
	/** @type {string} */
	token;
	/** @type {string} */
	agent;
	/** @type {string} */
	version;
	/** @type {string} */
	name;
	/** @type {string} */
	id;
	/** @type {string|undefined} */
	publicAddress;
	/** @type {Object<string, string>} */
	plugins;

	constructor(token, agent, version, name, id, publicAddress, plugins) {
		this.token = token;
		this.agent = agent;
		this.version = version;
		this.name = name;
		this.id = id;
		this.publicAddress = publicAddress;
		this.plugins = plugins;
	}

	static jsonSchema = {
		type: "object",
		required: ["token", "agent", "version", "name", "id", "plugins"],
		properties: {
			"token": { type: "string" },
			"agent": { type: "string" },
			"version": { type: "string" },
			"name": { type: "string" },
			"id": { type: "integer" },
			"publicAddress": { type: "string" },
			"plugins": {
				type: "object",
				additionalProperties: { type: "string" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.token, json.agent, json.version, json.name, json.id, json.publicAddress, json.plugins);
	}
}

/** @memberof module:lib/data */
class MessageRegisterHost extends Message {
	/** @type {module:lib/data.RegisterHostData} */
	data;

	constructor(data) {
		super("registerHost");
		this.data = data;
	}

	static jsonSchema = {
		type: "object",
		required: ["type", "data"],
		properties: {
			"type": { const: "registerHost" },
			"data": RegisterHostData.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(RegisterHostData.fromJSON(json.data));
	}
};

/** @memberof module:lib/data */
class RegisterControlData {
	/** @type {string} */
	token;
	/** @type {string} */
	agent;
	/** @type {string} */
	version;

	constructor(token, agent, version) {
		this.token = token;
		this.agent = agent;
		this.version = version;
	}

	static jsonSchema = {
		type: "object",
		required: ["token", "agent", "version"],
		properties: {
			"token": { type: "string" },
			"agent": { type: "string" },
			"version": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.token, json.agent, json.version);
	}
}

/** @memberof module:lib/data */
class MessageRegisterControl extends Message {
	/** @type {module:lib/data.RegisterControlData} */
	data;

	constructor(data) {
		super("registerControl");
		this.data = data;
	}

	static jsonSchema = {
		type: "object",
		required: ["data"],
		properties: {
			"type": { const: "registerControl" },
			"data": RegisterControlData.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(RegisterControlData.fromJSON(json.data));
	}
};

/** @memberof module:lib/data */
class AccountDetails {
	/** @type {string} */
	name;
	/** @type {Array} */
	roles;

	constructor(name, roles) {
		this.name = name;
		this.roles = roles;
	}

	static jsonSchema = {
		additionalProperties: false,
		required: ["name", "roles"],
		properties: {
			"name": { type: "string" },
			"roles": {
				type: "array",
				items: {
					additionalProperties: false,
					type: "object",
					required: ["name", "id", "permissions"],
					properties: {
						"name": { type: "string" },
						"id": { type: "integer" },
						"permissions": {
							type: "array",
							items: { type: "string" },
						},
					},
				},
			},
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.roles);
	}
}

/** @memberof module:lib/data */
class ReadyData {
	/** @type {module:lib/data.Address} */
	src;
	/** @type {string} */
	sessionToken;
	/** @type {number} */
	sessionTimeout;
	/** @type {number} */
	heartbeatInterval;
	/** @type {AccountDetails|undefined} */
	account;

	constructor(src, sessionToken, sessionTimeout, heartbeatInterval, account) {
		this.src = src;
		this.sessionToken = sessionToken;
		this.sessionTimeout = sessionTimeout;
		this.heartbeatInterval = heartbeatInterval;
		if (account) { this.account = account; }
	}

	static jsonSchema = {
		additionalProperties: false,
		required: ["src", "sessionToken", "sessionTimeout", "heartbeatInterval"],
		properties: {
			"src": Address.jsonSchema,
			"sessionToken": { type: "string" },
			"sessionTimeout": { type: "number" },
			"heartbeatInterval": { type: "number" },
			"account": AccountDetails.jsonSchema,
		},
	};

	static fromJSON(json) {
		let account;
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

/** @memberof module:lib/data */
class MessageReady extends Message {
	/** @type {module:lib/data.ReadyData} */
	data;

	constructor(data) {
		super("ready");
		this.data = data;
	}

	static jsonSchema = {
		type: "object",
		required: ["data"],
		properties: {
			"type": { const: "ready" },
			"data": ReadyData.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(ReadyData.fromJSON(json.data));
	}
}

/** @memberof module:lib/data */
class ResumeData {
	/** @type {string} */
	sessionToken;
	/** @type {integer|undefined} */
	lastSeq;

	constructor(sessionToken, lastSeq) {
		this.sessionToken = sessionToken;
		if (lastSeq !== undefined) { this.lastSeq = lastSeq; }
	}

	static jsonSchema = {
		type: "object",
		required: ["sessionToken"],
		properties: {
			"sessionToken": { type: "string" },
			"lastSeq": { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.sessionToken, json.lastSeq);
	}
}


/** @memberof module:lib/data */
class MessageResume extends Message {
	/** @type {module:lib/data.ResumeData} */
	data;

	constructor(data) {
		super("resume");
		this.data = data;
	}

	static jsonSchema = {
		type: "object",
		required: ["data"],
		properties: {
			"type": { const: "resume" },
			"data": ResumeData.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(ResumeData.fromJSON(json.data));
	}
}

/** @memberof module:lib/data */
class ContinueData {
	/** @type {number} */
	sessionTimeout;
	/** @type {number} */
	heartbeatInterval;
	/** @type {integer|undefined} */
	lastSeq;

	constructor(sessionTimeout, heartbeatInterval, lastSeq) {
		this.sessionTimeout = sessionTimeout;
		this.heartbeatInterval = heartbeatInterval;
		if (lastSeq !== undefined) { this.lastSeq = lastSeq; }
	}

	static jsonSchema = {
		required: ["sessionTimeout", "heartbeatInterval"],
		properties: {
			"sessionTimeout": { type: "number" },
			"heartbeatInterval": { type: "number" },
			"lastSeq": { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.sessionTimeout, json.heartbeatInterval, json.lastSeq);
	}
}

/** @memberof module:lib/data */
class MessageContinue extends Message {
	/** @type {module:lib/data.ContinueData} */
	data;

	constructor(data) {
		super("continue");
		this.data = data;
	}

	static jsonSchema = {
		type: "object",
		required: ["data"],
		properties: {
			"type": { const: "continue" },
			"data": ContinueData.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(ContinueData.fromJSON(json.data));
	}
}

/** @memberof module:lib/data */
class MessageInvalidate extends Message {
	constructor() {
		super("invalidate");
	}

	static jsonSchema = {
		type: "object",
		properties: {
			"type": { const: "invalidate" },
		},
	};

	static fromJSON(json) {
		return new this();
	}
}

/** @memberof module:lib/data */
class MessageHeartbeat extends Message {
	/** @type {integer|undefined} */
	seq;

	constructor(seq) {
		super("heartbeat");
		this.seq = seq;
	}

	static jsonSchema = {
		type: "object",
		required: ["type"],
		properties: {
			"type": { const: "heartbeat" },
			"seq": { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.seq);
	}
}

/** @memberof module:lib/data */
class MessageRequest extends Message {
	/** @type {number} */
	seq;
	/** @type {Address} */
	src;
	/** @type {Address} */
	dst;
	/** @type {string} */
	name;
	/** @type {*} */
	data;

	constructor(seq, src, dst, name, data) {
		super("request");
		this.seq = seq;
		this.src = src;
		this.dst = dst;
		this.name = name;
		this.data = data;
	}

	static jsonSchema = {
		type: "object",
		required: ["type", "seq", "src", "dst", "name"],
		properties: {
			"type": { const: "request" },
			"seq": { type: "integer" },
			"src": Address.jsonSchema,
			"dst": Address.jsonSchema,
			"name": { type: "string" },
			"data": {},
		},
	};

	static fromJSON(json) {
		return new this(
			json.seq,
			Address.fromJSON(json.src),
			Address.fromJSON(json.dst),
			json.name,
			json.data,
		);
	}
};

/** @memberof module:lib/data */
class MessageResponse extends Message {
	/** @type {number} */
	seq;
	/** @type {Address} */
	src;
	/** @type {Address} */
	dst;
	/** @type {*} */
	data;

	constructor(seq, src, dst, data) {
		super("response");
		this.seq = seq;
		this.src = src;
		this.dst = dst;
		this.data = data;
	}

	static jsonSchema = {
		type: "object",
		required: ["type", "seq", "src", "dst"],
		properties: {
			"type": { const: "response" },
			"seq": { type: "integer" },
			"src": Address.jsonSchema,
			"dst": Address.jsonSchema,
			"data": {},
		},
	};

	static fromJSON(json) {
		return new this(
			json.seq,
			Address.fromJSON(json.src),
			Address.fromJSON(json.dst),
			json.data,
		);
	}
};

/** @memberof module:lib/data */
class ResponseError {
	/** @type {string} */
	message;
	/** @type {string|undefined} */
	code;
	/** @type {string|undefined} */
	stack;

	constructor(message, code, stack) {
		this.message = message;
		if (code) { this.code = code; }
		if (stack) { this.stack = stack; }
	}

	static jsonSchema = {
		required: ["message"],
		properties: {
			"message": { type: "string" },
			"code": { type: "string" },
			"stack": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.message, json.code, json.stack);
	}
}

/** @memberof module:lib/data */
class MessageResponseError extends Message {
	/** @type {number} */
	seq;
	/** @type {Address} */
	src;
	/** @type {Address} */
	dst;
	/** @type {module:lib/data.ResponseError} */
	data;

	constructor(seq, src, dst, data) {
		super("responseError");
		this.seq = seq;
		this.src = src;
		this.dst = dst;
		this.data = data;
	}

	static jsonSchema = {
		type: "object",
		required: ["type", "seq", "src", "dst", "data"],
		properties: {
			"type": { const: "responseError" },
			"seq": { type: "integer" },
			"src": Address.jsonSchema,
			"dst": Address.jsonSchema,
			"data": ResponseError.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(
			json.seq,
			Address.fromJSON(json.src),
			Address.fromJSON(json.dst),
			ResponseError.fromJSON(json.data),
		);
	}
};

/** @memberof module:lib/data */
class MessageEvent extends Message {
	/** @type {number} */
	seq;
	/** @type {Address} */
	src;
	/** @type {Address} */
	dst;
	/** @type {string} */
	name;
	/** @type {*} */
	data;

	constructor(seq, src, dst, name, data) {
		super("event");
		this.seq = seq;
		this.src = src;
		this.dst = dst;
		this.name = name;
		this.data = data;
	}

	static jsonSchema = {
		type: "object",
		required: ["type", "seq", "src", "dst", "name"],
		properties: {
			"type": { const: "event" },
			"seq": { type: "integer" },
			"src": Address.jsonSchema,
			"dst": Address.jsonSchema,
			"name": { type: "string" },
			"data": {},
		},
	};

	static fromJSON(json) {
		return new this(
			json.seq,
			Address.fromJSON(json.src),
			Address.fromJSON(json.dst),
			json.name,
			json.data,
		);
	}
};

/** @memberof module:lib/data */
class MessageDisconnect extends Message {
	/** @type {string} */
	data;

	constructor(stage) {
		super("disconnect");
		this.data = stage;
	}

	static jsonSchema = {
		type: "object",
		required: ["type"],
		properties: {
			"type": { const: "disconnect" },
			"data": { enum: ["prepare", "ready"] },
		},
	};

	static fromJSON(json) {
		return new this(json.data);
	}
};

Message.jsonSchema = {
	type: "object",
	required: ["type"],
	properties: {
		"type": { enum: [
			"hello", "registerHost", "registerControl", "ready", "resume", "continue", "invalidate",
			"heartbeat", "request", "response", "responseError", "event", "disconnect",
		] },
	},
	oneOf: [
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
	],
};
Message.validate = libSchema.compile(Message.jsonSchema);

/** @memberof module:lib/data */
class PingRequest {
	static type = "request";
	static src = ["controller", "host", "control"];
	static dst = ["controller", "host", "control"];
	static permission = null;
}

module.exports = {
	Message,
	HelloData,
	MessageHello,
	RegisterHostData,
	MessageRegisterHost,
	RegisterControlData,
	MessageRegisterControl,
	AccountDetails,
	ReadyData,
	MessageReady,
	ResumeData,
	MessageResume,
	ContinueData,
	MessageContinue,
	MessageInvalidate,
	MessageHeartbeat,
	Address,
	MessageRequest,
	MessageResponse,
	ResponseError,
	MessageResponseError,
	MessageEvent,
	MessageDisconnect,
	PingRequest,
};
