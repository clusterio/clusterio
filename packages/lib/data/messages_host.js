"use strict";
const { jsonArray } = require("./composites");


/** @memberof module:lib */
class HostDetails {
	/** @type {string} */
	agent;
	/** @type {string} */
	version;
	/** @type {string} */
	name;
	/** @type {number} */
	id;
	/** @type {boolean} */
	connected;
	/** @type {string|undefined} */
	publicAddress;

	constructor(agent, version, name, id, connected, publicAddress) {
		this.agent = agent;
		this.version = version;
		this.name = name;
		this.id = id;
		this.connected = connected;
		if (publicAddress !== undefined) { this.publicAddress = publicAddress; }
	}

	static jsonSchema = {
		type: "object",
		required: ["agent", "version", "name", "id", "connected"],
		properties: {
			"agent": { type: "string" },
			"version": { type: "string" },
			"name": { type: "string" },
			"id": { type: "integer" },
			"connected": { type: "boolean" },
			"publicAddress": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.agent, json.version, json.name, json.id, json.connected, json.publicAddress);
	}
}

/** @memberof module:lib */
class HostListRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.host.list";
	static Response = jsonArray(HostDetails);
}

/* @memberof module:lib */
class HostSetSubscriptionsRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.host.subscribe";

	/** @type {boolean} */
	all;
	/** @type {Array<number>} */
	hostIds;

	constructor(all, hostIds) {
		this.all = all;
		this.hostIds = hostIds;
	}

	static jsonSchema = {
		type: "object",
		required: ["all", "hostIds"],
		properties: {
			all: { type: "boolean" },
			hostIds: {
				type: "array",
				items: { type: "integer" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.all, json.hostIds);
	}
}


/* @memberof module:lib */
class HostUpdateEvent {
	static type = "event";
	static src = "controller";
	static dst = "control";

	/** @type {module:lib.HostDetails} */
	update;

	constructor(update) {
		this.update = update;
	}

	static jsonSchema = {
		type: "object",
		required: ["update"],
		properties: {
			update: HostDetails.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(HostDetails.fromJSON(json.update));
	}
}

/** @memberof module:lib */
class HostMetricsRequest {
	static type = "request";
	static src = "controller";
	static dst = "host";
}
HostMetricsRequest.Response = class Response { // TODO: Use JSON class pattern in Prometheus
	/** @type {array} */
	results;

	constructor(results) {
		this.results = results;
	}

	static jsonSchema = {
		type: "object",
		required: ["results"],
		properties: {
			"results": {
				type: "array",
			},
		},
	};

	static fromJSON(json) {
		return new this(json.results);
	}
};

/** @memberof module:lib */
class ControllerConnectionEvent {
	static type = "event";
	static src = "host";
	static dst = "instance";

	/** @type {string} */
	event;

	constructor(event) {
		this.event = event;
	}

	static jsonSchema = {
		type: "object",
		required: ["event"],
		properties: {
			"event": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.event);
	}
}

/* @memberof module:lib */
class PrepareControllerDisconnectRequest {
	static type = "request";
	static src = "host";
	static dst = "instance";
}

/** @memberof module:lib */
class SyncUserListsEvent {
	static type = "event";
	static src = "controller";
	static dst = "host";

	/** @type {Set<string>} */
	adminlist;
	/** @type {Map<string, string>} */
	banlist;
	/** @type {Set<string>} */
	whitelist;

	constructor(adminlist, banlist, whitelist) {
		this.adminlist = adminlist;
		this.banlist = banlist;
		this.whitelist = whitelist;
	}

	static jsonSchema = {
		type: "object",
		required: ["adminlist", "banlist", "whitelist"],
		properties: {
			"adminlist": {
				type: "array",
				items: { type: "string" },
			},
			"banlist": {
				type: "array",
				items: {
					type: "array",
					minItems: 2,
					items: [{ type: "string" }, { type: "string" }],
				},
			},
			"whitelist": {
				type: "array",
				items: { type: "string" },
			},
		},
	};

	static fromJSON(json) {
		return new this(new Set(json.adminlist), new Set(json.banlist), new Set(json.whitelist));
	}

	static toJSON() {
		return {
			adminlist: [...this.adminlist],
			banlist: [...this.banlist],
			whitelist: [...this.whitelist],
		};
	}
}

module.exports = {
	HostDetails,
	HostListRequest,
	HostSetSubscriptionsRequest,
	HostUpdateEvent,
	HostMetricsRequest,
	ControllerConnectionEvent,
	PrepareControllerDisconnectRequest,
	SyncUserListsEvent,
};
