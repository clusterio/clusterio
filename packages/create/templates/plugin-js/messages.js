"use strict";
const { plainJson, jsonArray, JsonBoolean, JsonNumber, JsonString, StringEnum } = require("@clusterio/lib");
const { Type } = require("@sinclair/typebox");

class PluginExampleEvent {
	static type = "event";
	static src = ["host", "control"];
	static dst = ["controller", "host", "instance"];
	static plugin = "__plugin_name__";
	static permission = "__plugin_name__.example.permission.event";

	constructor(myString, myNumberArray) {
		this.myString = myString;
		this.myNumberArray = myNumberArray;
	}

	static jsonSchema = Type.Object({
		"myString": Type.String(),
		"myNumberArray": Type.Array(Type.Number()),
	});

	static fromJSON(json) {
		return new PluginExampleEvent(json.myString, json.myNumberArray);
	}
}

class PluginExampleRequest {
	static type = "request";
	static src = ["host", "control"];
	static dst = ["controller", "host", "instance"];
	static plugin = "__plugin_name__";
	static permission = "__plugin_name__.example.permission.request";

	constructor(myString, myNumberArray) {
		this.myString = myString;
		this.myNumberArray = myNumberArray;
	}

	static jsonSchema = Type.Object({
		"myString": Type.String(),
		"myNumberArray": Type.Array(Type.Number()),
	});

	static fromJSON(json) {
		return new PluginExampleRequest(json.myString, json.myNumberArray);
	}

	static Response = plainJson(Type.Object({
		"myResponseString": Type.String(),
		"myResponseNumbers": Type.Array(Type.Number()),
	}));
}
//%if controller & web // Subscribing requires web content and the controller

class ExampleSubscribableValue {
	constructor(id, updatedAtMs, isDeleted) {
		this.id = id;
		this.updatedAtMs = updatedAtMs;
		this.isDeleted = isDeleted;
	}

	static jsonSchema = Type.Object({
		id: Type.String(),
		updatedAtMs: Type.Number(),
		isDeleted: Type.Boolean(),
	});

	static fromJSON(json) {
		return new this(json.id, json.updatedAtMs, json.isDeleted);
	}
}

class ExampleSubscribableUpdate {
	static type = "event";
	static src = "controller";
	static dst = "control";
	static plugin = "__plugin_name__";
	static permission = "__plugin_name__.example.permission.subscribe";

	constructor(updates) {
		this.updates = updates;
	}

	static jsonSchema = Type.Object({
		"updates": Type.Array(ExampleSubscribableValue.jsonSchema),
	});

	static fromJSON(json) {
		return new this(json.updates.map(update => ExampleSubscribableValue.fromJSON(update)));
	}
}
//%endif

module.exports = {
	PluginExampleEvent,
	PluginExampleRequest,
//%if controller & web // Subscribing requires web content and the controller
	ExampleSubscribableValue,
	ExampleSubscribableUpdate,
//%endif
};
