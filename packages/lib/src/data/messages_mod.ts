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

// Define the structure for the latest release info from the portal
const ModPortalReleaseSchema = Type.Object({
	version: Type.String(),
	// Match the structure from ModStore's ModRelease/ModDetails
	info_json: Type.Object({ factorio_version: Type.String() }),
	released_at: Type.String(), // ISO 8601 date string
	download_url: Type.String(),
	file_name: Type.String(),
	sha1: Type.String(),
});

// Define the structure for mod details returned by the portal API
// This should align with the ModDetails interface in ModStore.ts
const ModPortalDetailsSchema = Type.Object({
	name: Type.String(),
	title: Type.String(),
	summary: Type.String(),
	owner: Type.String(),
	downloads_count: Type.Integer(),
	category: Type.Optional(Type.String()), // Add optional category
	score: Type.Optional(Type.Number()), // Add optional score
	latest_release: Type.Optional(ModPortalReleaseSchema),
	// Add releases array if needed: releases: Type.Optional(Type.Array(ModPortalReleaseSchema)),
});

export class ModPortalGetAllRequest {
	declare ["constructor"]: typeof ModPortalGetAllRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.mod.search_portal" as const; // Reuse search permission for now

	// Define allowed Factorio versions
	static allowedVersions = [
		Type.Literal("0.13"), Type.Literal("0.14"), Type.Literal("0.15"),
		Type.Literal("0.16"), Type.Literal("0.17"), Type.Literal("0.18"),
		Type.Literal("1.0"), Type.Literal("1.1"), Type.Literal("2.0"),
	] as const;

	constructor(
		public factorioVersion: Static<typeof ModPortalGetAllRequest.allowedVersions[number]>,
		public hide_deprecated?: boolean,
	) { }

	static jsonSchema = Type.Object({
		"factorioVersion": Type.Union([...this.allowedVersions]), // Use Union for validation
		"hide_deprecated": Type.Optional(Type.Boolean()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.factorioVersion, json.hide_deprecated);
	}

	// Define the Response class inline
	static Response = class ModPortalGetAllResponse {
		declare ["constructor"]: typeof ModPortalGetAllResponse;
		constructor(
			public mods: Static<typeof ModPortalDetailsSchema>[],
		) { }

		static jsonSchema = Type.Object({
			mods: Type.Array(ModPortalDetailsSchema),
		});

		static fromJSON(json: Static<typeof this.jsonSchema>) {
			// No transformation needed if schema matches API structure
			return new this(json.mods);
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
