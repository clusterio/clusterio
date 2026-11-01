import { Type, Static } from "@sinclair/typebox";
import { jsonArray } from "./composites.js";
import type { PluginNodeEnvInfo } from "../plugin.js";
import { Address, MessageRequest } from "./messages_core.js";
import type { IUser } from "./UserDetails.js";

export const pluginStateSchema = Type.Union([
	Type.Literal("loaded"),
	Type.Literal("disabled"),
	Type.Literal("unloadOnRestart"),
	Type.Literal("loadOnRestart"),
	Type.Literal("noEntrypoint"),
	Type.Literal("pendingInstall"),
	Type.Literal("removed"),
	Type.Literal("removedLoaded"),
	Type.Literal("nameTaken"),
]);
/**
 * State of a plugin on a machine
 *
 * - loaded: Running and loaded again on the next restart
 * - disabled: Not loaded as `<plugin>.load_plugin` is false
 * - unloadOnRestart: Running, but disabled since startup
 * - loadOnRestart: Not running, enabled since startup or skipped by recovery mode
 * - noEntrypoint: Has no entrypoint for this machine, so it is never loaded here
 * - pendingInstall: Installed since startup, loaded on the next restart
 * - removed: Uninstalled since startup while not running
 * - removedLoaded: Uninstalled since startup, running until the next restart
 * - nameTaken: Not loaded as another package provides a plugin with the same name
 */
export type PluginState = Static<typeof pluginStateSchema>;

/* This is similar to other plugin definitions but with lots removed */
export class PluginDetails {
	constructor(
		public name: string,
		public title: string,
		public version: string,
		public state: PluginState,
		public description?: string,
		public npmPackage?: string,
		/** Version installed on disk, differs from version when an update is waiting for a restart */
		public installedVersion?: string,
		/** Name in the root package.json dependencies, differs from npmPackage for aliases */
		public dependencyName?: string,
	) {}

	static jsonSchema = Type.Object({
		name: Type.String(),
		title: Type.String(),
		version: Type.String(),
		// Missing from 2.0.3 and older, which require loaded and enabled instead
		state: Type.Optional(pluginStateSchema),
		loaded: Type.Boolean(),
		enabled: Type.Boolean(),
		description: Type.Optional(Type.String()),
		npmPackage: Type.Optional(Type.String()),
		installedVersion: Type.Optional(Type.String()),
		dependencyName: Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.name, json.title, json.version, json.state ?? this.loadState(json.loaded, json.enabled),
			json.description, json.npmPackage, json.installedVersion, json.dependencyName,
		);
	}

	toJSON(): Static<typeof PluginDetails.jsonSchema> {
		return {
			name: this.name,
			title: this.title,
			version: this.version,
			state: this.state,
			loaded: this.loaded,
			enabled: this.loadsOnRestart,
			description: this.description,
			npmPackage: this.npmPackage,
			installedVersion: this.installedVersion,
			dependencyName: this.dependencyName,
		};
	}

	/** State of a plugin known since startup */
	static loadState(loaded: boolean, enabled: boolean): PluginState {
		if (loaded) {
			return enabled ? "loaded" : "unloadOnRestart";
		}
		return enabled ? "loadOnRestart" : "disabled";
	}

	static fromNodeEnvInfo(pluginInfo: PluginNodeEnvInfo, state: PluginState) {
		return new this(
			pluginInfo.name, pluginInfo.title, pluginInfo.version, state,
			pluginInfo.description, pluginInfo.npmPackage,
		);
	}

	/** Plugin package installed since startup, it is loaded on the next restart */
	static fromPackageJson(packageName: string, packageJson: any, npmPackage?: string, dependencyName?: string) {
		const description = typeof packageJson.description === "string" ? packageJson.description : undefined;
		return new this(
			packageName, packageName, packageJson.version, "pendingInstall",
			description, npmPackage, packageJson.version, dependencyName,
		);
	}

	/** Running on the machine now */
	get loaded() {
		return ["loaded", "unloadOnRestart", "removedLoaded"].includes(this.state);
	}

	/** Running on the machine after the next restart */
	get loadsOnRestart() {
		return ["loaded", "loadOnRestart", "pendingInstall"].includes(this.state);
	}

	/** Uninstalled since startup */
	get removed() {
		return this.state === "removed" || this.state === "removedLoaded";
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

/* Latest version of each package published on npm, used to offer plugin updates */
export class PluginLatestVersionsRequest {
	declare ["constructor"]: typeof PluginLatestVersionsRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.plugin.list";

	constructor(
		public packages: string[],
	) {}

	static jsonSchema = Type.Object({
		packages: Type.Array(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.packages);
	}

	static Response = class Response {
		constructor(
			/** Package name to its latest version, packages not found on npm are left out */
			public versions: Record<string, string>,
		) {}

		static jsonSchema = Type.Object({
			versions: Type.Record(Type.String(), Type.String()),
		});

		static fromJSON(json: Static<typeof this.jsonSchema>) {
			return new this(json.versions);
		}
	};
}

export class UpdateAllRequest {
	declare ["constructor"]: typeof UpdateAllRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = ["controller", "host"] as const;
	static permission(user: IUser, message: MessageRequest) {
		user.checkPermission(message.dst.type === Address.host ? "core.host.update" : "core.controller.update");
		user.checkPermission("core.plugin.update");
	}
}
