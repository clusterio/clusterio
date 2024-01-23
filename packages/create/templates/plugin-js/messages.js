"use strict";
const { plainJson, jsonArray, JsonBoolean, JsonNumber, JsonString, StringEnum } = require("@clusterio/lib");
const { Type, Static } = require("@sinclair/typebox");

class PluginExampleEvent {
	static type = "event";
	static src = ["host", "control"];
	static dst = ["controller", "host", "instance"];
	static plugin = "// plugin_name //";
	static permission = "// plugin_name //.example.permission.event";

	constructor(myString, myNumberArray) {
		this.myString = myString;
		this.myNumberArray = myNumberArray;
	}

	static jsonSchema = Type.Object({
		"myString": Type.String(),
		"myNumberArray": Type.Array(Type.Number()),
	});

	static fromJson(json) {
		return new PluginExampleEvent(json.myString, json.myNumberArray);
	}
}

class PluginExampleRequest {
	static type = "request";
	static src = ["host", "control"];
	static dst = ["controller", "host", "instance"];
	static plugin = "// plugin_name //";
	static permission = "// plugin_name //.example.permission.request";

	constructor(myString, myNumberArray) {
		this.myString = myString;
		this.myNumberArray = myNumberArray;
	}

	static jsonSchema = Type.Object({
		"myString": Type.String(),
		"myNumberArray": Type.Array(Type.Number()),
	});

	static fromJson(json) {
		return new PluginExampleEvent(json.myString, json.myNumberArray);
	}

	static Response = plainJson(Type.Object({
		"myResponseString": Type.String(),
		"myResponseNumbers": Type.Array(Type.Number()),
	}));
}

module.exports = {
	PluginExampleEvent,
	PluginExampleRequest,
};
