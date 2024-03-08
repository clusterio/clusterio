import { plainJson, jsonArray, JsonBoolean, JsonNumber, JsonString, StringEnum } from "@clusterio/lib";
import { Type, Static } from "@sinclair/typebox";

export class PluginExampleEvent {
	declare ["constructor"]: typeof PluginExampleEvent;
	static type = "event" as const;
	static src = ["host", "control"] as const;
	static dst = ["controller", "host", "instance"] as const;
	static plugin = "__plugin_name__" as const;
	static permission = "__plugin_name__.example.permission.event";

	constructor(
		public myString: string,
		public myNumberArray: number[],
	) {
	}

	static jsonSchema = Type.Object({
		"myString": Type.String(),
		"myNumberArray": Type.Array(Type.Number()),
	});

	static fromJSON(json: Static<typeof PluginExampleEvent.jsonSchema>) {
		return new PluginExampleEvent(json.myString, json.myNumberArray);
	}
}

export class PluginExampleRequest {
	declare ["constructor"]: typeof PluginExampleRequest;
	static type = "request" as const;
	static src = ["host", "control"] as const;
	static dst = ["controller", "host", "instance"] as const;
	static plugin = "__plugin_name__" as const;
	static permission = "__plugin_name__.example.permission.request";

	constructor(
		public myString: string,
		public myNumberArray: number[],
	) {
	}

	static jsonSchema = Type.Object({
		"myString": Type.String(),
		"myNumberArray": Type.Array(Type.Number()),
	});

	static fromJSON(json: Static<typeof PluginExampleRequest.jsonSchema>) {
		return new PluginExampleRequest(json.myString, json.myNumberArray);
	}

	static Response = plainJson(Type.Object({
		"myResponseString": Type.String(),
		"myResponseNumbers": Type.Array(Type.Number()),
	}));
}
//%if controller & web // Subscribing requires web content and the controller

export class ExampleSubscribableValue {
	constructor(
		public id: string,
		public updatedAtMs: number,
		public isDeleted: boolean,
	) {
	}

	static jsonSchema = Type.Object({
		id: Type.String(),
		updatedAtMs: Type.Number(),
		isDeleted: Type.Boolean(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.id, json.updatedAtMs, json.isDeleted);
	}
}

export class ExampleSubscribableUpdate {
	declare ["constructor"]: typeof ExampleSubscribableUpdate;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static plugin = "__plugin_name__" as const;
	static permission = "__plugin_name__.example.permission.subscribe";

	constructor(
		public updates: ExampleSubscribableValue[],
	) { }

	static jsonSchema = Type.Object({
		"updates": Type.Array(ExampleSubscribableValue.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates.map(update => ExampleSubscribableValue.fromJSON(update)));
	}
}
//%endif
