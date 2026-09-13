import { Type, type Static } from "@sinclair/typebox";
import { jsonArray } from "./composites.ts";
import type { PluginNodeEnvInfo } from "../plugin.ts";
import { Address, MessageRequest } from "./messages_core.ts";
import type { IUser } from "./UserDetails.ts";

/* This is similar to other plugin definitions but with lots removed */
export class PluginDetails {
	name: string;
	title: string;
	version: string;
	loaded: boolean;
	enabled: boolean;
	description?: string;
	npmPackage?: string;

	constructor(
		name: string,
		title: string,
		version: string,
		loaded: boolean,
		enabled: boolean,
		description?: string,
		npmPackage?: string,
	) {
		this.name = name;
		this.title = title;
		this.version = version;
		this.loaded = loaded;
		this.enabled = enabled;
		this.description = description;
		this.npmPackage = npmPackage;
	}

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

	pluginPackage: string;

	constructor(
		pluginPackage: string,
	) {
		this.pluginPackage = pluginPackage;
	}

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

	pluginPackage: string;

	constructor(
		pluginPackage: string,
	) {
		this.pluginPackage = pluginPackage;
	}

	static jsonSchema = Type.String();

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json);
	}

	toJSON() {
		return this.pluginPackage;
	}
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
