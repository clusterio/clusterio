"use strict";
const { libData } = require("@clusterio/lib");

class ContributionEvent {
	static type = "event";
	static src = "instance";
	static dst = "controller";
	static plugin = "research_sync";

	/** @type {string} */
	name;
	/** @type {number} */
	level;
	/** @type {number} */
	contribution;

	constructor(name, level, contribution) {
		this.name = name;
		this.level = level;
		this.contribution = contribution;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "level", "contribution"],
		properties: {
			name: { type: "string" },
			level: { type: "integer" },
			contribution: { type: "number" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.level, json.contribution);
	}
}

class ProgressEvent {
	static type = "event";
	static src = "controller";
	static dst = "instance";
	static plugin = "research_sync";

	/** @type {Array<>} */
	technologies;

	constructor(technologies) {
		this.technologies = technologies;
	}

	static jsonSchema = {
		type: "object",
		required: ["technologies"],
		properties: {
			technologies: {
				type: "array",
				items: {
					type: "object",
					required: ["name", "level", "progress"],
					properties: {
						name: { type: "string" },
						level: { type: "integer" },
						progress: { type: "number" },
					},
					additionalProperties: false,
				},
			},
		},
	};

	static fromJSON(json) {
		return new this(json.technologies);
	}
}

class FinishedEvent {
	static type = "event";
	static src = ["instance", "controller"];
	static dst = "instance";
	static plugin = "research_sync";

	/** @type {string} */
	name;
	/** @type {number} */
	level;

	constructor(name, level) {
		this.name = name;
		this.level = level;
	}

	static jsonSchema = {
		type: "object",
		required: ["name", "level"],
		properties: {
			name: { type: "string" },
			level: { type: "integer" },
		},
	};

	static fromJSON(json) {
		return new this(json.name, json.level);
	}
}

class Technology {
	/** @type {string} */
	name;
	/** @type {number} */
	level;
	/** @type {?number} */
	progress;
	/** @type {boolean} */
	researched;

	constructor(name, level, progress, researched) {
		this.name = name;
		this.level = level;
		this.progress = progress;
		this.researched = researched;
	}

	static jsonSchema = {
		type: "array",
		minItems: 4,
		maxItems: 4,
		items: [
			{ type: "string" },
			{ type: "integer" },
			{ type: ["null", "number"] },
			{ type: "boolean" },
		],
	};

	toJSON() {
		return [this.name, this.level, this.progress, this.researched];
	}

	static fromJSON(json) {
		return new this(json[0], json[1], json[2], json[3]);
	}
}

class SyncTechnologiesRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "research_sync";

	/** @type {Array<Technology>} */
	technologies;

	constructor(technologies) {
		this.technologies = technologies;
	}

	static jsonSchema = {
		type: "array",
		items: Technology.jsonSchema,
	};

	toJSON() {
		return this.technologies;
	}

	static fromJSON(json) {
		return new this(json.map(e => Technology.fromJSON(e)));
	}

	static Response = libData.jsonArray(Technology);
}

module.exports = {
	ContributionEvent,
	ProgressEvent,
	FinishedEvent,
	Technology,
	SyncTechnologiesRequest,
};
