"use strict";
const { JsonString } = require("./composites");

// TODO: remove after config refactor
/** @memberof module:lib/data */
class RawConfig {
	/** @type {object} */
	serializedConfig;

	constructor(serializedConfig) {
		this.serializedConfig = serializedConfig;
	}

	static jsonSchema = {
		type: "object",
		required: ["serializedConfig"],
		properties: {
			"serializedConfig": { type: "object" },
		},
	};

	static fromJSON(json) {
		return new this(json.serializedConfig);
	}
}

/* @memberof module:lib/data */
class ControllerConfigGetRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.controller.get_config";
	static Response = RawConfig;
}

/** @memberof module:lib/data */
class ControllerConfigSetFieldRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.controller.update_config";

	/** @type {string} */
	field;
	/** @type {string} */
	value;

	constructor(field, value) {
		this.field = field;
		this.value = value;
	}

	static jsonSchema = {
		type: "object",
		required: ["field", "value"],
		properties: {
			"field": { type: "string" },
			"value": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.field, json.value);
	}
}

/* @memberof module:lib/data */
class ControllerConfigSetPropRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.controller.update_config";

	/** @type {string} */
	field;
	/** @type {string} */
	prop;
	/** @type {undefined} */
	value;

	constructor(field, prop, value) {
		this.field = field;
		this.prop = prop;
		if (value) { this.value = value; }
	}

	static jsonSchema = {
		type: "object",
		required: ["field", "prop"],
		properties: {
			field: { type: "string" },
			prop: { type: "string" },
			value: {},
		},
	};

	static fromJSON(json) {
		return new this(json.field, json.prop, json.value);
	}
}

/* @memberof module:lib/data */
class HostGenerateTokenRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.host.generate_token";

	/** @type {?number} */
	hostId;

	constructor(hostId) {
		this.hostId = hostId;
	}

	static jsonSchema = {
		type: "object",
		required: ["hostId"],
		properties: {
			hostId: { type: ["integer", "null"] },
		},
	};

	static fromJSON(json) {
		return new this(json.hostId);
	}

	static Response = JsonString;
}

/** @memberof module:lib/data */
class HostConfigCreateRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.host.create_config";

	/** @type {?number} */
	id;
	/** @type {?string} */
	name;
	/** @type {boolean} */
	generateToken;

	constructor(id, name, generateToken) {
		this.id = id;
		this.name = name;
		this.generateToken = generateToken;
	}

	static jsonSchema = {
		type: "object",
		required: ["id", "name", "generateToken"],
		properties: {
			"id": { type: ["integer", "null"] },
			"name": { type: ["string", "null"] },
			"generateToken": { type: "boolean" },
		},
	};

	static fromJSON(json) {
		return new this(json.id, json.name, json.generateToken);
	}

	static Response = RawConfig;
}

/* @memberof module:lib/data */
class LogSetSubscriptionsRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.log.follow";

	/** @type {boolean} */
	all;
	/** @type {boolean} */
	controller;
	/** @type {array} */
	hostIds;
	/** @type {array} */
	instanceIds;
	/** @type {?string} */
	maxLevel;

	constructor(all, controller, hostIds, instanceIds, maxLevel) {
		this.all = all;
		this.controller = controller;
		this.hostIds = hostIds;
		this.instanceIds = instanceIds;
		this.maxLevel = maxLevel;
	}

	static jsonSchema = {
		type: "object",
		required: ["all", "controller", "hostIds", "instanceIds", "maxLevel"],
		properties: {
			all: { type: "boolean" },
			controller: { type: "boolean" },
			hostIds: {
				type: "array",
				items: { type: "integer" },
			},
			instanceIds: {
				type: "array",
				items: { type: "integer" },
			},
			maxLevel: { type: ["string", "null"] },
		},
	};

	static fromJSON(json) {
		return new this(json.all, json.controller, json.hostIds, json.instanceIds, json.maxLevel);
	}
}

/* @memberof module:lib/data */
class LogQueryRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.log.query";

	/** @type {boolean} */
	all;
	/** @type {boolean} */
	controller;
	/** @type {Array<number>} */
	hostIds;
	/** @type {Array<number>} */
	instanceIds;
	/** @type {?string} */
	maxLevel;
	/** @type {integer} */
	limit;
	/** @type {undefined} */
	order;

	constructor(all, controller, hostIds, instanceIds, maxLevel, limit, order) {
		this.all = all;
		this.controller = controller;
		this.hostIds = hostIds;
		this.instanceIds = instanceIds;
		this.maxLevel = maxLevel;
		this.limit = limit;
		this.order = order;
	}

	static jsonSchema = {
		type: "object",
		required: ["all", "controller", "hostIds", "instanceIds", "maxLevel", "limit", "order"],
		properties: {
			all: { type: "boolean" },
			controller: { type: "boolean" },
			hostIds: {
				type: "array",
				items: { type: "integer" },
			},
			instanceIds: {
				type: "array",
				items: { type: "integer" },
			},
			maxLevel: { type: ["string", "null"] },
			limit: { type: "integer" },
			order: {
				enum: ["asc", "desc"],
			},
		},
	};

	static fromJSON(json) {
		return new this(
			json.all, json.controller, json.hostIds, json.instanceIds, json.maxLevel, json.limit, json.order
		);
	}
}
LogQueryRequest.Response = class Response {
	/** @type {Array<object>} */
	log;

	constructor(log) {
		this.log = log;
	}

	static jsonSchema = {
		type: "object",
		required: ["log"],
		properties: {
			log: {
				type: "array",
				items: { type: "object" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.log);
	}
};

/** @memberof module:lib/data */
class LogMessageEvent {
	static type = "event";
	static src = "host";
	static dst = "controller";

	/** @type {object} */
	info;

	constructor(info) {
		this.info = info;
	}

	static jsonSchema = {
		type: "object",
		required: ["info"],
		properties: {
			"info": {
				type: "object",
				required: ["level", "message"],
				properties: {
					"level": { type: "string" },
					"message": { type: "string" },
				},
			},
		},
	};

	static fromJSON(json) {
		return new this(json.info);
	}
}

/* @memberof module:lib/data */
class DebugDumpWsRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.debug.dump_ws";
}

/* @memberof module:lib/data */
class DebugWsMessageEvent {
	static type = "event";
	static src = "controller";
	static dst = "control";

	/** @type {string} */
	direction;
	/** @type {string} */
	content;

	constructor(direction, content) {
		this.direction = direction;
		this.content = content;
	}

	static jsonSchema = {
		type: "object",
		required: ["direction", "content"],
		properties: {
			direction: { type: "string" },
			content: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.direction, json.content);
	}
}

module.exports = {
	RawConfig,
	ControllerConfigGetRequest,
	ControllerConfigSetFieldRequest,
	ControllerConfigSetPropRequest,
	HostGenerateTokenRequest,
	HostConfigCreateRequest,
	LogSetSubscriptionsRequest,
	LogQueryRequest,
	LogMessageEvent,
	DebugDumpWsRequest,
	DebugWsMessageEvent,
};
