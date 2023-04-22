"use strict";
const ModPack = require("./ModPack");
const ModInfo = require("./ModInfo");
const { jsonArray, JsonString } = require("./composites");


/* @memberof module:lib/data */
class ModPackGetRequest {
	static type = "request";
	static src = ["instance", "control"];
	static dst = "controller";
	static permission = "core.mod_pack.get";

	/** @type {number} */
	id;

	constructor(id) {
		this.id = id;
	}

	static jsonSchema = {
		type: "object",
		required: ["id"],
		properties: {
			id: { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.id);
	}

	static Response = ModPack;
}

/* @memberof module:lib/data */
class ModPackGetDefaultRequest {
	static type = "request";
	static src = ["instance", "control"];
	static dst = "controller";
	static permission = "core.mod_pack.get";
	static Response = ModPack;
}

/* @memberof module:lib/data */
class ModPackListRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod_pack.list";
	static Response = jsonArray(ModPack);
}

/** @memberof module:lib/data */
class ModPackCreateRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod_pack.create";

	/** @type {module:lib/data.ModPack} */
	modPack;

	constructor(modPack) {
		this.modPack = modPack;
	}

	static jsonSchema = {
		type: "object",
		required: ["modPack"],
		properties: {
			"modPack": ModPack.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(ModPack.fromJSON(json.modPack));
	}
}

/* @memberof module:lib/data */
class ModPackUpdateRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod_pack.update";

	/** @type {module:lib/data.ModPack} */
	modPack;

	constructor(modPack) {
		this.modPack = modPack;
	}

	static jsonSchema = {
		type: "object",
		required: ["modPack"],
		properties: {
			"modPack": ModPack.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(ModPack.fromJSON(json.modPack));
	}
}

/* @memberof module:lib/data */
class ModPackDeleteRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod_pack.delete";

	/** @type {number} */
	id;

	constructor(id) {
		this.id = id;
	}

	static jsonSchema = {
		type: "object",
		required: ["id"],
		properties: {
			id: { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.id);
	}
}

/* @memberof module:lib/data */
class ModPackSetSubscriptionsRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod_pack.subscribe";

	/** @type {boolean} */
	all;
	/** @type {Array<number>} */
	modPackIds;

	constructor(all, modPackIds) {
		this.all = all;
		this.modPackIds = modPackIds;
	}

	static jsonSchema = {
		type: "object",
		required: ["all", "modPackIds"],
		properties: {
			all: { type: "boolean" },
			modPackIds: {
				type: "array",
				items: { type: "integer" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.all, json.modPackIds);
	}
}

/* @memberof module:lib/data */
class ModGetRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.get";

	/** @type {string} */
	name;
	/** @type {string} */
	version;

	constructor(name, version) {
		this.name = name;
		this.version = version;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "version"],
		properties: {
			name: { type: "string" },
			version: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.version);
	}

	static Response = ModInfo;
}

/* @memberof module:lib/data */
class ModListRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.list";
	static Response = jsonArray(ModInfo);
}

/* @memberof module:lib/data */
class ModSearchRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.search";

	/** @type {string} */
	query;
	/** @type {string} */
	factorioVersion;
	/** @type {number} */
	page;
	/** @type {number|undefined} */
	pageSize;
	/** @type {string|undefined} */
	sort;
	/** @type {string|undefined} */
	sortOrder;

	constructor(query, factorioVersion, page, pageSize, sort, sortOrder) {
		this.query = query;
		this.factorioVersion = factorioVersion;
		this.page = page;
		if (pageSize) { this.pageSize = pageSize; }
		if (sort) { this.sort = sort; }
		if (sortOrder) { this.sortOrder = sortOrder; }
	}

	static jsonSchema = {
		type: "object",
		required: ["query", "factorioVersion", "page"],
		properties: {
			query: { type: "string" },
			factorioVersion: { type: "string" },
			pageSize: { type: "integer" },
			page: { type: "integer" },
			sort: { type: "string" },
			sortOrder: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.query, json.factorioVersion, json.page, json.pageSize, json.sort, json.sortOrder);
	}
}
ModSearchRequest.Response = class Response {
	/** @type {Array<string>} */
	queryIssues;
	/** @type {number} */
	pageCount;
	/** @type {number} */
	resultCount;
	/** @type {Array<object>} */
	results;

	constructor(queryIssues, pageCount, resultCount, results) {
		this.queryIssues = queryIssues;
		this.pageCount = pageCount;
		this.resultCount = resultCount;
		this.results = results;
	}

	static jsonSchema = {
		type: "object",
		required: ["queryIssues", "pageCount", "resultCount", "results"],
		properties: {
			queryIssues: {
				type: "array",
				items: { type: "string" },
			},
			pageCount: { type: "integer" },
			resultCount: { type: "integer" },
			results: {
				type: "array",
				items: {
					type: "object",
					properties: {
						name: { type: "string" },
						versions: {
							type: "array",
							items: ModInfo.jsonSchema,
						},
					},
				},
			},
		},
	};

	static fromJSON(json) {
		let results = json.results.map(
			({ name, versions }) => ({ name, versions: versions.map(mod => ModInfo.fromJSON(mod)) })
		);
		return new this(json.queryIssues, json.pageCount, json.resultCount, results);
	}
};

/* @memberof module:lib/data */
class ModSetSubscriptionsRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.subscribe";

	/** @type {boolean} */
	all;
	/** @type {Array<string>} */
	modNames;

	constructor(all, modNames) {
		this.all = all;
		this.modNames = modNames;
	}

	static jsonSchema = {
		type: "object",
		required: ["all", "modNames"],
		properties: {
			all: { type: "boolean" },
			modNames: {
				type: "array",
				items: { type: "string" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.all, json.modNames);
	}
}

/* @memberof module:lib/data */
class ModDownloadRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.download";

	/** @type {string} */
	name;
	/** @type {string} */
	version;

	constructor(name, version) {
		this.name = name;
		this.version = version;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "version"],
		properties: {
			name: { type: "string" },
			version: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.version);
	}

	static Response = JsonString;
}

/* @memberof module:lib/data */
class ModDeleteRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.delete";

	/** @type {string} */
	name;
	/** @type {string} */
	version;

	constructor(name, version) {
		this.name = name;
		this.version = version;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "version"],
		properties: {
			name: { type: "string" },
			version: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.version);
	}
}

/* @memberof module:lib/data */
class ModPackUpdateEvent {
	static type = "event";
	static src = "controller";
	static dst = "control";

	/** @type {module:lib/data.ModPack} */
	modPack;

	constructor(modPack) {
		this.modPack = modPack;
	}

	static jsonSchema = {
		type: "object",
		required: ["modPack"],
		properties: {
			modPack: ModPack.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(ModPack.fromJSON(json.modPack));
	}
}

/* @memberof module:lib/data */
class ModUpdateEvent {
	static type = "event";
	static src = "controller";
	static dst = "control";

	/** @type {module:lib/data.ModInfo} */
	mod;

	constructor(mod) {
		this.mod = mod;
	}

	static jsonSchema = {
		type: "object",
		required: ["mod"],
		properties: {
			mod: ModInfo.jsonSchema,
		},
	};

	static fromJSON(json) {
		return new this(ModInfo.fromJSON(json.mod));
	}
}

module.exports = {
	ModPackGetRequest,
	ModPackGetDefaultRequest,
	ModPackListRequest,
	ModPackCreateRequest,
	ModPackUpdateRequest,
	ModPackDeleteRequest,
	ModPackSetSubscriptionsRequest,
	ModGetRequest,
	ModListRequest,
	ModSearchRequest,
	ModSetSubscriptionsRequest,
	ModDownloadRequest,
	ModDeleteRequest,
	ModPackUpdateEvent,
	ModUpdateEvent,
};
