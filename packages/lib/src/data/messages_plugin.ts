import { Type, Static } from "@sinclair/typebox";
import { jsonArray } from "./composites";
import { PluginNodeEnvInfo } from "../plugin";

/* This is similar to other plugin definitions but with lots removed */
export class PluginDetails {
	constructor(
		public name: string,
		public title: string,
		public version: string,
		public loaded: boolean,
		public enabled: boolean,
		public description?: string,
		public npmPackage?: string,
	) {}

	static jsonSchema = Type.Object({
		name: Type.String(),
		title: Type.String(),
		version: Type.String(),
		loaded: Type.Boolean(),
		enabled: Type.Boolean(),
		description: Type.Optional(Type.String()),
		npmPackage: Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.name, json.title, json.version, json.loaded, json.enabled,
			json.description, json.npmPackage
		);
	}

	static fromNodeEnvInfo(pluginInfo: PluginNodeEnvInfo, loaded: boolean, enabled: boolean) {
		return new this(
			pluginInfo.name, pluginInfo.title, pluginInfo.version, loaded, enabled,
			pluginInfo.description, pluginInfo.npmPackage,
		);
	}
}

export class PluginListRequest {
	declare ["constructor"]: typeof PluginListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = ["controller", "host"] as const;
	static permission = "core.plugin.list";
	static Response = jsonArray(PluginDetails);
}

export class PluginUpdateRequest {
	declare ["constructor"]: typeof PluginUpdateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = ["controller", "host"] as const;
	static permission = "core.plugin.update";

	constructor(
		public pluginPackage: string,
	) {}

	static jsonSchema = Type.String();

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json);
	}

	toJSON() {
		return this.pluginPackage;
	}
}

export class PluginInstallRequest {
	declare ["constructor"]: typeof PluginInstallRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = ["controller", "host"] as const;
	static permission = "core.plugin.install";

	constructor(
		public pluginPackage: string,
	) {}

	static jsonSchema = Type.String();

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json);
	}

	toJSON() {
		return this.pluginPackage;
	}
}

/* Plugin package listed on the npm registry */
export class PluginSearchResult {
	constructor(
		public name: string,
		public version: string,
		public description?: string,
		public publisher?: string,
		public date?: string,
		public homepage?: string,
		public repository?: string,
		public npm?: string,
	) {}

	static jsonSchema = Type.Object({
		name: Type.String(),
		version: Type.String(),
		description: Type.Optional(Type.String()),
		publisher: Type.Optional(Type.String()),
		date: Type.Optional(Type.String()),
		homepage: Type.Optional(Type.String()),
		repository: Type.Optional(Type.String()),
		npm: Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.name, json.version, json.description, json.publisher,
			json.date, json.homepage, json.repository, json.npm,
		);
	}
}

export class PluginSearchRequest {
	declare ["constructor"]: typeof PluginSearchRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.plugin.search";

	constructor(
		public query: string = "",
		public page: number = 1,
		public pageSize: number = 20,
	) {}

	static jsonSchema = Type.Object({
		query: Type.String(),
		page: Type.Integer(),
		pageSize: Type.Integer(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.query, json.page, json.pageSize);
	}

	static Response = class Response {
		constructor(
			public total: number,
			public results: PluginSearchResult[],
		) {}

		static jsonSchema = Type.Object({
			total: Type.Integer(),
			results: Type.Array(PluginSearchResult.jsonSchema),
		});

		static fromJSON(json: Static<typeof this.jsonSchema>) {
			return new this(json.total, json.results.map(r => PluginSearchResult.fromJSON(r)));
		}
	};
}
