import { plainJson, jsonArray, JsonBoolean, JsonNumber, JsonString, StringEnum } from "@clusterio/lib";
import { Type, Static } from "@sinclair/typebox";

export class PluginExampleEvent {
	declare ["constructor"]: typeof PluginExampleEvent;
	static type = "event" as const;
	static src = ["host"] as const;
	static dst = "controller" as const;
	static plugin = "// plugin_name //" as const;
	static permission = "// plugin_name //.example.permission.event";

	constructor(
		public myString: string,
		public myNumberArray: number[],
	) {
	}

	static jsonSchema = Type.Object({
		"myString": Type.String(),
		"myNumberArray": Type.Array(Type.Number()),
	});

	static fromJson(json: Static<typeof PluginExampleEvent.jsonSchema>) {
		return new PluginExampleEvent(json.myString, json.myNumberArray);
	}
}

export class PluginExampleRequest {
	declare ["constructor"]: typeof PluginExampleEvent;
	static type = "request" as const;
	static src = ["host"] as const;
	static dst = "controller" as const;
	static plugin = "// plugin_name //" as const;
	static permission = "// plugin_name //.example.permission.request";

	constructor(
		public myString: string,
		public myNumberArray: number[],
	) {
	}

	static jsonSchema = Type.Object({
		"myString": Type.String(),
		"myNumberArray": Type.Array(Type.Number()),
	});

	static fromJson(json: Static<typeof PluginExampleEvent.jsonSchema>) {
		return new PluginExampleEvent(json.myString, json.myNumberArray);
	}

	static Response = plainJson(Type.Object({
		"myResponseString": Type.String(),
		"myResponseNumbers": Type.Array(Type.Number()),
	}));
}
