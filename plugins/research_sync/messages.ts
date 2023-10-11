import { Type, Static } from "@sinclair/typebox";
import * as lib from "@clusterio/lib";

export class ContributionEvent {
	declare ["constructor"]: typeof ContributionEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "research_sync" as const;

	constructor(
		public name: string,
		public level: number,
		public contribution: number
	) {
	}

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"level": Type.Integer(),
		"contribution": Type.Number(),
	});

	static fromJSON(json: Static<typeof ContributionEvent.jsonSchema>): ContributionEvent {
		return new this(json.name, json.level, json.contribution);
	}
}


export class TechnologyProgress {
	constructor(
		public name: string,
		public level: number,
		public progress: number | null,
	) {
	}

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"level": Type.Integer(),
		"progress": Type.Number(),
	});
}

export class ProgressEvent {
	declare ["constructor"]: typeof ProgressEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "instance" as const;
	static plugin = "research_sync" as const;

	constructor(
		public technologies: TechnologyProgress[],
	) {
	}

	static jsonSchema = Type.Object({
		"technologies": Type.Array(
			TechnologyProgress.jsonSchema
		),
	});

	static fromJSON(json: Static<typeof ProgressEvent.jsonSchema>): ProgressEvent {
		return new this(json.technologies);
	}
}

export class FinishedEvent {
	declare ["constructor"]: typeof FinishedEvent;
	static type = "event" as const;
	static src = ["instance", "controller"] as const;
	static dst = "instance" as const;
	static plugin = "research_sync" as const;

	constructor(
		public name: string,
		public level: number,
	) {
	}

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"level": Type.Integer(),
	});

	static fromJSON(json: Static<typeof FinishedEvent.jsonSchema>): FinishedEvent {
		return new this(json.name, json.level);
	}
}

export class TechnologySync {
	constructor(
		public name: string,
		public level: number,
		public progress: number | null,
		public researched: boolean,
	) {
	}

	static jsonSchema = Type.Tuple([
		Type.String(),
		Type.Integer(),
		Type.Union([Type.Number(), Type.Null()]),
		Type.Boolean(),
	]);

	toJSON() {
		return [this.name, this.level, this.progress, this.researched];
	}

	static fromJSON(json: Static<typeof TechnologySync.jsonSchema>): TechnologySync {
		return new this(json[0], json[1], json[2], json[3]);
	}
}

export class SyncTechnologiesRequest {
	declare ["constructor"]: typeof SyncTechnologiesRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "research_sync" as const;

	constructor(
		public technologies: TechnologySync[]
	) {
	}

	static jsonSchema = Type.Array(TechnologySync.jsonSchema);
	toJSON() {
		return this.technologies;
	}

	static fromJSON(json: Static<typeof SyncTechnologiesRequest.jsonSchema>): SyncTechnologiesRequest {
		return new this(json.map(e => TechnologySync.fromJSON(e)));
	}

	static Response = lib.jsonArray(TechnologySync);
}
