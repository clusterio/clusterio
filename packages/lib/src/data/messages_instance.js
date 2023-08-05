"use strict";
const PlayerStats = require("../PlayerStats").default;
const { JsonString, jsonArray } = require("./composites");

/** @memberof module:lib */
class InstanceDetails {
	/** @type {string} */
	name;
	/** @type {number} */
	id;
	/** @type {?integer} */
	assignedHost;
	/** @type {?integer} */
	gamePort;
	/** @type {string} */
	status;

	constructor(name, id, assignedHost, gamePort, status) {
		this.name = name;
		this.id = id;
		this.assignedHost = assignedHost;
		this.gamePort = gamePort;
		this.status = status;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "id", "assignedHost", "gamePort", "status"],
		properties: {
			"name": { type: "string" },
			"id": { type: "integer" },
			"assignedHost": { type: ["null", "integer"] },
			"gamePort": { type: ["null", "integer"] },
			"status": { enum: [
				"unknown", "unassigned", "stopped", "starting", "running", "stopping",
				"creating_save", "exporting_data", "deleted",
			]},
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.id, json.assignedHost, json.gamePort, json.status);
	}
}

/** @memberof module:lib */
class InstanceDetailsGetRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.instance.get";

	/** @type {number} */
	instanceId;

	constructor(instanceId) {
		this.instanceId = instanceId;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId"],
		properties: {
			"instanceId": { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId);
	}

	static Response = InstanceDetails;
}

/** @memberof module:lib */
class InstanceDetailsListRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.instance.list";
	static Response = jsonArray(InstanceDetails);
};

/** @memberof module:lib */
class InstanceDetailsSetSubscriptionsRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.instance.subscribe";

	/** @type {boolean} */
	all;

	/** @type {Array<number>} */
	instanceIds;

	constructor(all, instanceIds) {
		this.all = all || false;
		this.instanceIds = instanceIds || [];
	}

	static jsonSchema = {
		type: "object",
		properties: {
			"all": { type: "boolean" },
			"instanceIds": {
				type: "array",
				items: { type: "integer" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.all, json.instanceIds);
	}
};

/** @memberof module:lib */
class InstanceDetailsUpdateEvent {
	static type = "event";
	static src = "controller";
	static dst = "control";

	/** @type {module:lib.InstanceDetails} */
	details;

	constructor(details) {
		this.details = details;
	}

	static jsonSchema = InstanceDetails.jsonSchema;

	toJSON() {
		return this.details;
	}

	static fromJSON(json) {
		return new this(InstanceDetails.fromJSON(json));
	}
};

/** @memberof module:lib */
class InstanceCreateRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.instance.create";

	/** @type {object} */
	config;

	constructor(config) {
		this.config = config;
	}

	static jsonSchema = {
		type: "object",
		required: ["config"],
		properties: {
			"config": { type: "object" },
		},
	};

	static fromJSON(json) {
		// TODO deserialise config here after config refactor
		return new this(json.config);
	}
}

/** @memberof module:lib */
class InstanceConfigGetRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.instance.get_config";

	/** @type {number} */
	instanceId;

	constructor(instanceId) {
		this.instanceId = instanceId;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId"],
		properties: {
			"instanceId": { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId);
	}
}
// TODO replace with InstanceConfig after config refactor
InstanceConfigGetRequest.Response = class Response {
	/** @type {object} */
	config;

	constructor(config) {
		this.config = config;
	}

	static jsonSchema = {
		type: "object",
		required: ["config"],
		properties: {
			"config": { type: "object" },
		},
	};

	static fromJSON(json) {
		return new this(json.config);
	}
};

/** @memberof module:lib */
class InstanceConfigSetFieldRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.instance.update_config";

	/** @type {number} */
	instanceId;
	/** @type {string} */
	field;
	/** @type {string} */
	value;

	constructor(instanceId, field, value) {
		this.instanceId = instanceId;
		this.field = field;
		this.value = value;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "field", "value"],
		properties: {
			"instanceId": { type: "integer" },
			"field": { type: "string" },
			"value": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.field, json.value);
	}
}

/** @memberof module:lib */
class InstanceConfigSetPropRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.instance.update_config";

	/** @type {number} */
	instanceId;
	/** @type {string} */
	field;
	/** @type {string} */
	prop;
	/** @type {*} */
	value;

	constructor(instanceId, field, prop, value) {
		this.instanceId = instanceId;
		this.field = field;
		this.prop = prop;
		if (value !== undefined) {
			this.value = value;
		}
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "field", "prop"],
		properties: {
			"instanceId": { type: "integer" },
			"field": { type: "string" },
			"prop": { type: "string" },
			"value": {},
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.field, json.prop, json.value);
	}
}

/** @memberof module:lib */
class InstanceAssignRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.instance.assign";

	/** @type {number} */
	instanceId;
	/** @type {?number} */
	hostId;

	constructor(instanceId, hostId) {
		this.instanceId = instanceId;
		this.hostId = hostId;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "hostId"],
		properties: {
			"instanceId": { type: "number" },
			"hostId": { type: ["number", "null"] },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.hostId);
	}
}

/** @memberof module:lib */
class InstanceMetricsRequest {
	static type = "request";
	static src = "host";
	static dst = "instance";
}
InstanceMetricsRequest.Response = class Response { // TODO: Use JSON class pattern in Prometheus
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
class InstanceStartRequest {
	static type = "request";
	static src = ["control", "controller"];
	static dst = "instance";
	static permission = "core.instance.start";

	/** @type {string|undefined} */
	save;

	constructor(save) {
		if (save !== undefined) { this.save = save; };
	}

	static jsonSchema = {
		type: "object",
		properties: {
			"save": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.save);
	}
}

/** @memberof module:lib */
class SaveDetails {
	/** @type {string} */
	type;
	/** @type {string} */
	name;
	/** @type {number} */
	size;
	/** @type {number} */
	mtimeMs;
	/** @type {boolean} */
	loaded;
	/** @type {boolean} */
	loadByDefault;

	constructor(type, name, size, mtimeMs, loaded, loadByDefault) {
		this.type = type;
		this.name = name;
		this.size = size;
		this.mtimeMs = mtimeMs;
		this.loaded = loaded;
		this.loadByDefault = loadByDefault;
	}

	static jsonSchema = {
		type: "object",
		required: ["type", "name", "size", "mtimeMs", "loaded"],
		properties: {
			"type": { enum: ["file", "directory", "special"] },
			"name": { type: "string" },
			"size": { type: "integer" },
			"mtimeMs": { type: "number" },
			"loaded": { type: "boolean" },
			"loadByDefault": { type: "boolean" },
		},
	};

	static fromJSON(json) {
		return new this(json.type, json.name, json.size, json.mtimeMs, json.loaded, json.loadByDefault);
	}
}

/** @memberof module:lib */
class InstanceListSavesRequest {
	static type = "request";
	static src = "control";
	static dst = "instance";
	static permission = "core.instance.save.list";
	static Response = jsonArray(SaveDetails);
}

/** @memberof module:lib */
class InstanceSetSaveListSubscriptionsRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.instance.save.list_subscribe";

	/** @type {boolean} */
	all;

	/** @type {Array<number>} */
	instanceIds;

	constructor(all, instanceIds) {
		this.all = all || false;
		this.instanceIds = instanceIds || [];
	}

	static jsonSchema = {
		type: "object",
		properties: {
			"all": { type: "boolean" },
			"instanceIds": {
				type: "array",
				items: { type: "integer" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.all, json.instanceIds);
	}
};

/** @memberof module:lib */
class InstanceSaveListUpdateEvent {
	static type = "event";
	static src = ["instance", "host", "controller"];
	static dst = ["controller", "control"];

	/** @type {number} */
	instanceId;
	/** @type {module:lib.SaveDetails} */
	saves;

	constructor(instanceId, saves) {
		this.instanceId = instanceId;
		this.saves = saves;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "saves"],
		properties: {
			"instanceId": { type: "integer" },
			"saves": {
				type: "array",
				items: SaveDetails.jsonSchema,
			},
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.saves.map(i => SaveDetails.fromJSON(i)));
	}
}

/** @memberof module:lib */
class InstanceCreateSaveRequest {
	static type = "request";
	static src = "control";
	static dst = "instance";
	static permission = "core.instance.save.create";

	/** @type {string} */
	name;
	/** @type {?number} */
	seed;
	/** @type {?object} */
	mapGenSettings;
	/** @type {?object} */
	mapSettings;

	constructor(name, seed, mapGenSettings, mapSettings) {
		this.name = name;
		if (seed) { this.seed = seed; }
		if (mapGenSettings) { this.mapGenSettings = mapGenSettings; }
		if (mapSettings) { this.mapSettings = mapSettings; }
	}

	static jsonSchema = {
		type: "object",
		required: ["name"],
		properties: {
			"name": { type: "string" },
			"seed": { type: "integer" },
			"mapGenSettings": { type: "object" },
			"mapSettings": { type: "object" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.seed, json.mapGenSettings, json.mapSettings);
	}
}

/** @memberof module:lib */
class InstanceRenameSaveRequest {
	static type = "request";
	static src = ["control", "controller"];
	static dst = ["controller", "host"];
	static permission = "core.instance.save.rename";

	/** @type {number} */
	instanceId;
	/** @type {string} */
	oldName;
	/** @type {string} */
	newName;

	constructor(instanceId, oldName, newName) {
		this.instanceId = instanceId;
		this.oldName = oldName;
		this.newName = newName;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "oldName", "newName"],
		properties: {
			"instanceId": { type: "integer" },
			"oldName": { type: "string" },
			"newName": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.oldName, json.newName);
	}
}

/** @memberof module:lib */
class InstanceCopySaveRequest {
	static type = "request";
	static src = ["control", "controller"];
	static dst = ["controller", "host"];
	static permission = "core.instance.save.copy";

	/** @type {number} */
	instanceId;
	/** @type {string} */
	source;
	/** @type {string} */
	destination;

	constructor(instanceId, source, destination) {
		this.instanceId = instanceId;
		this.source = source;
		this.destination = destination;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "source", "destination"],
		properties: {
			"instanceId": { type: "integer" },
			"source": { type: "string" },
			"destination": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.source, json.destination);
	}
}

/** @memberof module:lib */
class InstanceDeleteSaveRequest {
	static type = "request";
	static src = ["control", "controller"];
	static dst = ["controller", "host"];
	static permission = "core.instance.save.delete";

	/** @type {number} */
	instanceId;
	/** @type {string} */
	name;

	constructor(instanceId, name) {
		this.instanceId = instanceId;
		this.name = name;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "name"],
		properties: {
			"instanceId": { type: "integer" },
			"name": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.name);
	}
}

/** @memberof module:lib */
class InstanceDownloadSaveRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.instance.save.download";

	/** @type {number} */
	instanceId;
	/** @type {string} */
	name;

	constructor(instanceId, name) {
		this.instanceId = instanceId;
		this.name = name;
	}

	static jsonSchema = {
		type: "object",
		required: ["name"],
		properties: {
			"instanceId": { type: "integer" },
			"name": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.name);
	}

	static Response = JsonString;
}

/** @memberof module:lib */
class InstanceTransferSaveRequest {
	static type = "request";
	static src = ["control", "controller"];
	static dst = ["controller", "host"];
	static permission(user, message) {
		user.checkPermission("core.instance.save.transfer");
		if (message.data.copy) {
			user.checkPermission("core.instance.save.copy");
		} else if (message.data.sourceName !== message.data.targetName) {
			user.checkPermission("core.instance.save.rename");
		}
	}


	/** @type {number} */
	sourceInstanceId;
	/** @type {string} */
	sourceName;
	/** @type {number} */
	targetInstanceId;
	/** @type {string} */
	targetName;
	/** @type {boolean} */
	copy;

	constructor(sourceInstanceId, sourceName, targetInstanceId, targetName, copy) {
		this.sourceInstanceId = sourceInstanceId;
		this.sourceName = sourceName;
		this.targetInstanceId = targetInstanceId;
		this.targetName = targetName;
		this.copy = copy;
	}

	static jsonSchema = {
		type: "object",
		required: ["sourceInstanceId", "sourceName", "targetInstanceId", "targetName", "copy"],
		properties: {
			"sourceInstanceId": { type: "number" },
			"sourceName": { type: "string" },
			"targetInstanceId": { type: "number" },
			"targetName": { type: "string" },
			"copy": { type: "boolean" },
		},
	};

	static fromJSON(json) {
		return new this(
			json.sourceInstanceId, json.sourceName, json.targetInstanceId, json.targetName, json.copy
		);
	}

	static Response = JsonString;
}


/** @memberof module:lib */
class InstancePullSaveRequest {
	static type = "request";
	static src = "controller";
	static dst = "host";

	/** @type {number} */
	instanceId;
	/** @type {string} */
	streamId;
	/** @type {string} */
	name;

	constructor(instanceId, streamId, name) {
		this.instanceId = instanceId;
		this.streamId = streamId;
		this.name = name;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "streamId", "name"],
		properties: {
			"instanceId": { type: "integer" },
			"streamId": { type: "string" },
			"name": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.streamId, json.name);
	}

	static Response = JsonString;
}

/** @memberof module:lib */
class InstancePushSaveRequest {
	static type = "request";
	static src = "controller";
	static dst = "host";

	/** @type {number} */
	instanceId;
	/** @type {string} */
	streamId;
	/** @type {string} */
	name;

	constructor(instanceId, streamId, name) {
		this.instanceId = instanceId;
		this.streamId = streamId;
		this.name = name;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "streamId", "name"],
		properties: {
			"instanceId": { type: "integer" },
			"streamId": { type: "string" },
			"name": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.streamId, json.name);
	}
}

/** @memberof module:lib */
class InstanceLoadScenarioRequest {
	static type = "request";
	static src = "control";
	static dst = "instance";
	static permission = "core.instance.load_scenario";

	/** @type {string} */
	scenario;
	/** @type {?number} */
	seed;
	/** @type {?object} */
	mapGenSettings;
	/** @type {?object} */
	mapSettings;

	constructor(scenario, seed, mapGenSettings, mapSettings) {
		this.scenario = scenario;
		if (seed) { this.seed = seed; }
		if (mapGenSettings) { this.mapGenSettings = mapGenSettings; }
		if (mapSettings) { this.mapSettings = mapSettings; }
	}

	static jsonSchema = {
		type: "object",
		required: ["scenario"],
		properties: {
			"scenario": { type: "string" },
			"seed": { type: "integer" },
			"mapGenSettings": { type: "object" },
			"mapSettings": { type: "object" },
		},
	};

	static fromJSON(json) {
		return new this(json.scenario, json.seed, json.mapGenSettings, json.mapSettings);
	}
}

/** @memberof module:lib */
class InstanceExportDataRequest {
	static type = "request";
	static src = "control";
	static dst = "instance";
	static permission = "core.instance.export_data";
}

/** @memberof module:lib */
class InstanceExtractPlayersRequest {
	static type = "request";
	static src = "control";
	static dst = "instance";
	static permission = "core.instance.extract_players";
}

/** @memberof module:lib */
class InstanceStopRequest {
	static type = "request";
	static src = "control";
	static dst = "instance";
	static permission = "core.instance.stop";
}

/** @memberof module:lib */
class InstanceKillRequest {
	static type = "request";
	static src = "control";
	static dst = "instance";
	static permission = "core.instance.kill";
}

/** @memberof module:lib */
class InstanceDeleteRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.instance.delete";

	/** @type {number} */
	instanceId;

	constructor(instanceId) {
		this.instanceId = instanceId;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId"],
		properties: {
			instanceId: { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId);
	}
}

/** @memberof module:lib */
class InstanceDeleteInternalRequest {
	static type = "request";
	static src = "controller";
	static dst = "host";

	/** @type {number} */
	instanceId;

	constructor(instanceId) {
		this.instanceId = instanceId;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId"],
		properties: {
			instanceId: { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId);
	}
}

/** @memberof module:lib */
class InstanceSendRconRequest {
	static type = "request";
	static src = "control";
	static dst = "instance";
	static permission = "core.instance.send_rcon";

	/** @type {string} */
	command;

	constructor(command) {
		this.command = command;
	}

	static jsonSchema = {
		type: "object",
		required: ["command"],
		properties: {
			"command": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.command);
	}

	static Response = JsonString;
}

// TODO remove this after config refactor
/** @memberof module:lib */
class RawInstanceInfo {
	/** @type {object} */
	config;

	/** @type {string} */
	status;

	constructor(config, status) {
		this.config = config;
		this.status = status;
	}

	static jsonSchema = {
		type: "object",
		required: ["config", "status"],
		properties: {
			"config": { type: "object" },
			"status": { enum: [
				"stopped", "starting", "running", "stopping", "creating_save", "exporting_data",
			]},
		},
	};

	static fromJSON(json) {
		return new this(json.config, json.status);
	}
}

/** @memberof module:lib */
class InstancesUpdateRequest {
	static type = "request";
	static src = "host";
	static dst = "controller";

	/** @type {Array<module:lib.RawInstanceInfo>} */
	instances;

	constructor(instances) {
		this.instances = instances;
	}

	static jsonSchema = {
		type: "array",
		items: RawInstanceInfo.jsonSchema,
	};

	toJSON() {
		return this.instances;
	}

	static fromJSON(json) {
		return new this(json.map(i => RawInstanceInfo.fromJSON(i)));
	}
}

/** @memberof module:lib */
class InstanceAssignInternalRequest {
	static type = "request";
	static src = "controller";
	static dst = "host";

	/** @type {number} */
	instanceId;
	/** @type {object} */
	config;

	constructor(instanceId, config) {
		this.instanceId = instanceId;
		this.config = config;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "config"],
		properties: {
			"instanceId": { type: "integer" },
			"config": { type: "object" },
		},
	};

	static fromJSON(json) {
		// TODO deserialise config here after config refactor
		return new this(json.instanceId, json.config);
	}
}

/** @memberof module:lib */
class InstanceUnassignInternalRequest {
	static type = "request";
	static src = "controller";
	static dst = "host";

	/** @type {number} */
	instanceId;

	constructor(instanceId) {
		this.instanceId = instanceId;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId"],
		properties: {
			"instanceId": { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId);
	}
}

/** @memberof module:lib */
class InstanceInitialisedEvent {
	static type = "event";
	static src = "instance";
	static dst = "host";

	/** @type {Object<string, string>} */
	plugins;

	constructor(plugins) {
		this.plugins = plugins;
	}

	static jsonSchema = {
		type: "object",
		required: ["plugins"],
		properties: {
			"plugins": {
				type: "object",
				additionalProperties: { type: "string" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.plugins);
	}
}

/** @memberof module:lib */
class InstanceStatusChangedEvent {
	static type = "event";
	static src = ["instance", "host"];
	static dst = "controller";

	/** @type {integer} */
	instanceId;
	/** @type {string} */
	status;
	/** @type {?number} */
	gamePort;

	constructor(instanceId, status, gamePort) {
		this.instanceId = instanceId;
		this.status = status;
		this.gamePort = gamePort;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceId", "status", "gamePort"],
		properties: {
			"instanceId": { type: "integer" },
			"status": {
				type: "string",
				enum: [
					"stopped", "starting", "running", "stopping", "creating_save", "exporting_data",
				],
			},
			"gamePort": { type: ["null", "integer"] },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceId, json.status, json.gamePort);
	}
}

/** @memberof module:lib */
class InstanceDetailsChangedEvent {
	static type = "event";
	static src = "instance";
	static dst = "controller";

	/** @type {module:lib.InstanceDetails} */
	details;

	constructor(details) {
		this.details = details;
	}

	static jsonSchema = InstanceDetails.jsonSchema;

	static fromJSON(json) {
		return new this(InstanceDetails.fromJSON(json));
	}
}

/** @memberof module:lib */
class InstanceBanlistUpdateEvent {
	static type = "event";
	static src = "controller";
	static dst = "instance";

	/** @type {string} */
	name;

	/** @type {boolean} */
	banned;

	/** @type {string} */
	reason;

	constructor(name, banned, reason) {
		this.name = name;
		this.banned = banned;
		this.reason = reason;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "banned", "reason"],
		properties: {
			"name": { type: "string" },
			"banned": { type: "boolean" },
			"reason": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.banned, json.reason);
	}
}

/** @memberof module:lib */
class InstanceAdminlistUpdateEvent {
	static type = "event";
	static src = "controller";
	static dst = "instance";

	/** @type {string} */
	name;

	/** @type {boolean} */
	admin;

	constructor(name, admin) {
		this.name = name;
		this.admin = admin;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "admin"],
		properties: {
			"name": { type: "string" },
			"admin": { type: "boolean" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.admin);
	}
}

/** @memberof module:lib */
class InstanceWhitelistUpdateEvent {
	static type = "event";
	static src = "controller";
	static dst = "instance";

	/** @type {string} */
	name;

	/** @type {boolean} */
	whitelisted;

	constructor(name, whitelisted) {
		this.name = name;
		this.whitelisted = whitelisted;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "whitelisted"],
		properties: {
			"name": { type: "string" },
			"whitelisted": { type: "boolean" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.whitelisted);
	}
}

/** @memberof module:lib */
class InstancePlayerUpdateEvent {
	static type = "event";
	static src = "instance";
	static dst = "controller";

	/** @type {string} */
	type;

	/** @type {string} */
	name;

	/** @type {?boolean} */
	reason;

	/** @type {?string} */
	stats;

	constructor(type, name, reason, stats) {
		this.type = type;
		this.name = name;
		if (reason !== undefined) { this.reason = reason; }
		if (stats !== undefined) { this.stats = stats; }
	}

	static jsonSchema = {
		type: "object",
		required: ["type", "name"],
		properties: {
			"type": { type: "string", enum: ["join", "leave", "import"] },
			"name": { type: "string" },
			"reason": { type: "string" },
			"stats": PlayerStats.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.whitelisted);
	}
}

module.exports = {
	InstanceDetails,
	InstanceDetailsGetRequest,
	InstanceDetailsListRequest,
	InstanceDetailsSetSubscriptionsRequest,
	InstanceDetailsUpdateEvent,
	InstanceCreateRequest,
	InstanceConfigGetRequest,
	InstanceConfigSetFieldRequest,
	InstanceConfigSetPropRequest,
	InstanceAssignRequest,
	InstanceMetricsRequest,
	InstanceStartRequest,
	SaveDetails,
	InstanceListSavesRequest,
	InstanceSetSaveListSubscriptionsRequest,
	InstanceSaveListUpdateEvent,
	InstanceCreateSaveRequest,
	InstanceRenameSaveRequest,
	InstanceCopySaveRequest,
	InstanceDeleteSaveRequest,
	InstanceDownloadSaveRequest,
	InstanceTransferSaveRequest,
	InstancePullSaveRequest,
	InstancePushSaveRequest,
	InstanceLoadScenarioRequest,
	InstanceExportDataRequest,
	InstanceExtractPlayersRequest,
	InstanceStopRequest,
	InstanceKillRequest,
	InstanceDeleteRequest,
	InstanceDeleteInternalRequest,
	InstanceSendRconRequest,
	RawInstanceInfo,
	InstancesUpdateRequest,
	InstanceAssignInternalRequest,
	InstanceUnassignInternalRequest,
	InstanceInitialisedEvent,
	InstanceStatusChangedEvent,
	InstanceDetailsChangedEvent,
	InstanceBanlistUpdateEvent,
	InstanceAdminlistUpdateEvent,
	InstanceWhitelistUpdateEvent,
	InstancePlayerUpdateEvent,
};
