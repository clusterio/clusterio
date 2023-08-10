import { Type, Static } from "@sinclair/typebox";
import ModInfo from "./ModInfo";
import ModPack from "./ModPack";
import { JsonString, jsonArray } from "./composites";


export class ModPackGetRequest {
	declare ["constructor"]: typeof ModPackGetRequest;
	static type = "request";
	static src = ["instance", "control"];
	static dst = "controller";
	static permission = "core.mod_pack.get";

	constructor(
		public id: number,
	) { }

	static jsonSchema = Type.Object({
		"id": Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.id);
	}

	static Response = ModPack;
}

export class ModPackGetDefaultRequest {
	declare ["constructor"]: typeof ModPackGetDefaultRequest;
	static type = "request";
	static src = ["instance", "control"];
	static dst = "controller";
	static permission = "core.mod_pack.get";
	static Response = ModPack;
}

export class ModPackListRequest {
	declare ["constructor"]: typeof ModPackListRequest;
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod_pack.list";
	static Response = jsonArray(ModPack);
}

export class ModPackCreateRequest {
	declare ["constructor"]: typeof ModPackCreateRequest;
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod_pack.create";

	constructor(
		public modPack: ModPack,
	) { }

	static jsonSchema = Type.Object({
		"modPack": ModPack.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(ModPack.fromJSON(json.modPack));
	}
}

export class ModPackUpdateRequest {
	declare ["constructor"]: typeof ModPackUpdateRequest;
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod_pack.update";

	constructor(
		public modPack: ModPack,
	) { }

	static jsonSchema = Type.Object({
		"modPack": ModPack.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(ModPack.fromJSON(json.modPack));
	}
}

export class ModPackDeleteRequest {
	declare ["constructor"]: typeof ModPackDeleteRequest;
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod_pack.delete";

	constructor(
		public id: number,
	) { }

	static jsonSchema = Type.Object({
		"id": Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.id);
	}
}

export class ModPackSetSubscriptionsRequest {
	declare ["constructor"]: typeof ModPackSetSubscriptionsRequest;
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod_pack.subscribe";

	constructor(
		public all: boolean,
		public modPackIds: number[],
	) { }

	static jsonSchema = Type.Object({
		"all": Type.Boolean(),
		"modPackIds": Type.Array(Type.Integer()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.all, json.modPackIds);
	}
}

export class ModGetRequest {
	declare ["constructor"]: typeof ModGetRequest;
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.get";

	constructor(
		public name: string,
		public version: string,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"version": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.version);
	}

	static Response = ModInfo;
}

export class ModListRequest {
	declare ["constructor"]: typeof ModListRequest;
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.list";
	static Response = jsonArray(ModInfo);
}

export class ModSearchRequest {
	declare ["constructor"]: typeof ModSearchRequest;
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.search";

	constructor(
		public query: string,
		public factorioVersion: string,
		public page: number,
		public pageSize?: number,
		public sort?: string,
		public sortOrder?: string,
	) { }

	static jsonSchema = Type.Object({
		"query": Type.String(),
		"factorioVersion": Type.String(),
		"pageSize": Type.Integer(),
		"page": Type.Optional(Type.Integer()),
		"sort": Type.Optional(Type.String()),
		"sortOrder": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.query, json.factorioVersion, json.page, json.pageSize, json.sort, json.sortOrder);
	}

	static Response = class Response {
		constructor(
			public queryIssues: string[],
			public pageCount: number,
			public resultCount: number,
			public results: object[],
		) { }

		static jsonSchema = Type.Object({
			"queryIssues": Type.Array(Type.String()),
			"pageCount": Type.Integer(),
			"resultCount": Type.Integer(),
			"results": Type.Array(
				Type.Object({
					"name": Type.String(),
					"versions": Type.Array(ModInfo.jsonSchema),
				}),
			),
		});

		static fromJSON(json: Static<typeof this.jsonSchema>) {
			let results = json.results.map(
				({ name, versions }) => ({ name, versions: versions.map(mod => ModInfo.fromJSON(mod)) })
			);
			return new this(json.queryIssues, json.pageCount, json.resultCount, results);
		}
	};
}

export class ModSetSubscriptionsRequest {
	declare ["constructor"]: typeof ModSetSubscriptionsRequest;
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.subscribe";

	constructor(
		public all: boolean,
		public modNames: string[],
	) { }

	static jsonSchema = Type.Object({
		"all": Type.Boolean(),
		"modNames": Type.Array(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.all, json.modNames);
	}
}

export class ModDownloadRequest {
	declare ["constructor"]: typeof ModDownloadRequest;
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.download";

	constructor(
		public name: string,
		public version: string,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"version": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.version);
	}

	static Response = JsonString;
}

export class ModDeleteRequest {
	declare ["constructor"]: typeof ModDeleteRequest;
	static type = "request";
	static src = "control";
	static dst = "controller";
	static permission = "core.mod.delete";

	constructor(
		public name: string,
		public version: string,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"version": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.version);
	}
}

export class ModPackUpdateEvent {
	declare ["constructor"]: typeof ModPackUpdateEvent;
	static type = "event";
	static src = "controller";
	static dst = "control";

	constructor(
		public modPack: ModPack,
	) { }

	static jsonSchema = Type.Object({
		"modPack": ModPack.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(ModPack.fromJSON(json.modPack));
	}
}

export class ModUpdateEvent {
	declare ["constructor"]: typeof ModUpdateEvent;
	static type = "event";
	static src = "controller";
	static dst = "control";

	constructor(
		public mod: ModInfo,
	) { }

	static jsonSchema = Type.Object({
		"mod": ModInfo.jsonSchema,
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(ModInfo.fromJSON(json.mod));
	}
}
