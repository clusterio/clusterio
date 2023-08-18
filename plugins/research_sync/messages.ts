import { Type, Static } from "@sinclair/typebox";
import * as lib from "@clusterio/lib";

export class ContributionEvent {
	static type = "event";
	static src = "instance";
	static dst = "controller";
	static plugin = "research_sync";

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
	})

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
	})
}

export class ProgressEvent {
	static type = "event";
	static src = "controller";
	static dst = "instance";
	static plugin = "research_sync";

	constructor(
		public technologies: TechnologyProgress[],
	) {
	}

	static jsonSchema = Type.Object({
		"technologies": Type.Array(
			TechnologyProgress.jsonSchema
		)
	})

	static fromJSON(json: Static<typeof ProgressEvent.jsonSchema>): ProgressEvent {
		return new this(json.technologies);
	}
}

export class FinishedEvent {
	static type = "event";
	static src = ["instance", "controller"];
	static dst = "instance";
	static plugin = "research_sync";

	constructor(
		public name: string,
		public level: number,
	) {
	}

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"level": Type.Integer(),
	})

	static fromJSON(json: Static<typeof FinishedEvent.jsonSchema>): FinishedEvent {
		return new this(json.name, json.level);
	}
}

export class Technology {
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
		Type.Union([ Type.Number(), Type.Null() ]),
		Type.Boolean(),
	])
	toJSON() {
		return [this.name, this.level, this.progress, this.researched];
	}

	static fromJSON(json: Static<typeof Technology.jsonSchema>): Technology {
		return new this(json[0], json[1], json[2], json[3]);
	}
}

export class SyncTechnologiesRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "research_sync";

	constructor(
		public technologies: Technology[]
	) {
	}

	static jsonSchema = Type.Array(Technology.jsonSchema);
	toJSON() {
		return this.technologies;
	}

	static fromJSON(json: Static<typeof SyncTechnologiesRequest.jsonSchema>): SyncTechnologiesRequest {
		return new this(json.map(e => Technology.fromJSON(e)));
	}

	static Response = lib.jsonArray(Technology);
}
