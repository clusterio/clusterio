import { Type, Static } from "@sinclair/typebox";
import { jsonArray } from "./composites";
import { PluginNodeEnvInfo } from "../plugin";

/* This is similar to other plugin definitions but with lots removed */
export class PluginDetails {
	constructor(
		public name: string,
		public title: string,
		public version: string,
		public description?: string,
		public npmPackage?: string,
	) {}

	static jsonSchema = Type.Object({
		name: Type.String(),
		title: Type.String(),
		version: Type.String(),
		description: Type.Optional(Type.String()),
		npmPackage: Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.title, json.version, json.description, json.npmPackage);
	}

	static fromNodeEnvInfo(pluginInfo: PluginNodeEnvInfo) {
		return new this(
			pluginInfo.name, pluginInfo.title,
			pluginInfo.version, pluginInfo.description,
			pluginInfo.npmPackage,
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
