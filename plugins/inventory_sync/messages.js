"use strict";


class AcquireRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "inventory_sync";

	/** @type {number} */
	instanceId;
	/** @type {string} */
	playerName;

	constructor(instanceId, playerName) {
		this.instanceId = instanceId;
		this.playerName = playerName;
	}

	static jsonSchema = {
		type: "object",
		properties: {
			"instanceId": { type: "integer" },
			"playerName": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.playerName);
	}
}
AcquireRequest.Response = class Response {
	/** @type {string} */
	status;
	/** @type {number} */
	generation;
	/** @type {boolean} */
	hasData;
	/** @type {string} */
	message;

	constructor(status, generation, hasData, message) {
		this.status = status;
		if (generation !== undefined) { this.generation = generation; }
		if (hasData !== undefined) { this.hasData = hasData; }
		if (message !== undefined) { this.message = message; }
	}

	static jsonSchema = {
		required: ["status"],
		properties: {
			"status": {
				type: "string",
				enum: ["acquired", "error", "busy"],
			},
			"generation": { type: "integer" },
			"hasData": { type: "boolean" },
			"message": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.status, json.generation, json.hasData, json.message);
	}
};

class ReleaseRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "inventory_sync";

	/** @type {boolean} */
	instanceId;
	/** @type {boolean} */
	playerName;

	constructor(instanceId, playerName) {
		this.instanceId = instanceId;
		this.playerName = playerName;
	}

	static jsonSchema = {
		type: "object",
		properties: {
			"instanceId": { type: "integer" },
			"playerName": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.playerName);
	}
}

class UploadRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "inventory_sync";

	/** @type {boolean} */
	instanceId;
	/** @type {boolean} */
	playerName;
	/** @type {object} */
	playerData;

	constructor(instanceId, playerName, playerData) {
		this.instanceId = instanceId;
		this.playerName = playerName;
		this.playerData = playerData;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "playerName", "playerData"],
		properties: {
			"instanceId": { type: "integer" },
			"playerName": { type: "string" },
			"playerData": { type: "object" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.playerName, json.playerData);
	}
}

class DownloadRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "inventory_sync";

	/** @type {number} */
	instanceId;
	/** @type {string} */
	playerName;

	constructor(instanceId, playerName) {
		this.instanceId = instanceId;
		this.playerName = playerName;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "playerName"],
		properties: {
			"instanceId": { type: "integer" },
			"playerName": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.playerName);
	}
}
DownloadRequest.Response = class Response {
	/** @type {?object} */
	playerData;

	constructor(playerData) {
		this.playerData = playerData;
	}

	static jsonSchema = {
		required: ["playerData"],
		properties: {
			"playerData": { type: ["object", "null"] },
		},
	};

	static fromJSON(json) {
		return new this(json.playerData);
	}
};

class DatabaseStatsRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static plugin = "inventory_sync";
	static permission = "inventory_sync.inventory.view";
}
DatabaseStatsRequest.Response = class Response {
	/** @type {boolean} */
	databaseSize;
	/** @type {boolean} */
	databaseEntries;
	/** @type {object} */
	largestEntry;

	constructor(databaseSize, databaseEntries, largestEntry) {
		this.databaseSize = databaseSize;
		this.databaseEntries = databaseEntries;
		this.largestEntry = largestEntry;
	}

	static jsonSchema = {
		type: "object",
		required: ["databaseSize", "databaseEntries", "largestEntry"],
		properties: {
			"databaseSize": { type: "integer" },
			"databaseEntries": { type: "integer" },
			"largestEntry": {
				type: "object",
				properties: {
					name: { type: "string" },
					size: { type: "number" },
				},
			},
		},
	};

	static fromJSON(json) {
		return new this(json.databaseSize, json.databaseEntries, json.largestEntry);
	}
};

module.exports = {
	AcquireRequest,
	ReleaseRequest,
	UploadRequest,
	DownloadRequest,
	DatabaseStatsRequest,
};
