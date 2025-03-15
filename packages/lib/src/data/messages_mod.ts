import { Type, Static } from "@sinclair/typebox";
import ModInfo from "./ModInfo";
import ModPack from "./ModPack";
import { JsonString, jsonArray } from "./composites";


export class ModPackGetRequest {
	declare ["constructor"]: typeof ModPackGetRequest;
	static type = "request" as const;
	static src = ["instance", "control"] as const;
	static dst = "controller" as const;
	static permission = "core.mod_pack.get" as const;

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
	static type = "request" as const;
	static src = ["instance", "control"] as const;
	static dst = "controller" as const;
	static permission = "core.mod_pack.get" as const;
	static Response = ModPack;
}

export class ModPackListRequest {
	declare ["constructor"]: typeof ModPackListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.mod_pack.list" as const;
	static Response = jsonArray(ModPack);
}

export class ModPackCreateRequest {
	declare ["constructor"]: typeof ModPackCreateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.mod_pack.create" as const;

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
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.mod_pack.update" as const;

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
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.mod_pack.delete" as const;

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

export class ModGetRequest {
	declare ["constructor"]: typeof ModGetRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.mod.get" as const;

	constructor(
		public name: string,
		public version: string,
		public sha1?: string,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"version": Type.String(),
		"sha1": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.version, json.sha1);
	}

	static Response = ModInfo;
}

export class ModListRequest {
	declare ["constructor"]: typeof ModListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.mod.list" as const;
	static Response = jsonArray(ModInfo);
}

export class ModSearchRequest {
	declare ["constructor"]: typeof ModSearchRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.mod.search" as const;

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
		"page": Type.Integer(),
		"pageSize": Type.Optional(Type.Integer()),
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
			public results: { name: string, versions: ModInfo[] }[],
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

export class ModPortalSearchRequest {
	declare ["constructor"]: typeof ModPortalSearchRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.mod.search_portal" as const;

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
		"page": Type.Integer(),
		"pageSize": Type.Optional(Type.Integer()),
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
			public results: {
				name: string,
				title: string,
				summary: string,
				owner: string,
				downloads_count: number,
				latest_release: {
					version: string,
					factorio_version: string,
					released_at: string,
					download_url: string,
					file_name: string,
					sha1: string,
				},
			}[],
		) { }

		static jsonSchema = Type.Object({
			"queryIssues": Type.Array(Type.String()),
			"pageCount": Type.Integer(),
			"resultCount": Type.Integer(),
			"results": Type.Array(
				Type.Object({
					"name": Type.String(),
					"title": Type.String(),
					"summary": Type.String(),
					"owner": Type.String(),
					"downloads_count": Type.Number(),
					"latest_release": Type.Object({
						"version": Type.String(),
						"factorio_version": Type.String(),
						"released_at": Type.String(),
						"download_url": Type.String(),
						"file_name": Type.String(),
						"sha1": Type.String(),
					}),
				}),
			),
		});

		static fromJSON(json: Static<typeof this.jsonSchema>) {
			return new this(
				json.queryIssues,
				json.pageCount,
				json.resultCount,
				json.results
			);
		}
	};
}

export class ModDownloadRequest {
	declare ["constructor"]: typeof ModDownloadRequest;
	static type = "request" as const;
	static src = ["host", "control"] as const;
	static dst = "controller" as const;
	static permission = "core.mod.download" as const;

	constructor(
		public name: string,
		public version: string,
		public sha1?: string,
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"version": Type.String(),
		"sha1": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.version, json.sha1);
	}

	static Response = JsonString;
}

export class ModDeleteRequest {
	declare ["constructor"]: typeof ModDeleteRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.mod.delete" as const;

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

export class ModPackUpdatesEvent {
	declare ["constructor"]: typeof ModPackUpdatesEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.mod_pack.subscribe" as const;

	constructor(
		public updates: ModPack[],
	) { }

	static jsonSchema = Type.Object({
		"updates": Type.Array(ModPack.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates.map(update => ModPack.fromJSON(update)));
	}
}

export class ModUpdatesEvent {
	declare ["constructor"]: typeof ModUpdatesEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.mod.subscribe" as const;

	constructor(
		public updates: ModInfo[],
	) { }

	static jsonSchema = Type.Object({
		"updates": Type.Array(ModInfo.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates.map(update => ModInfo.fromJSON(update)));
	}
}
