"use strict";

function jsonArray(ItemClass) {
	return {
		jsonSchema: {
			type: "array",
			items: ItemClass.jsonSchema,
		},

		fromJSON(json) {
			return json.map(i => ItemClass.fromJSON(i));
		},
	};
}

function jsonPrimitive(type) {
	return {
		jsonSchema: { type },
		fromJSON(json) {
			return json;
		},
	};
}
const JsonBoolean = jsonPrimitive("boolean");
const JsonNumber = jsonPrimitive("number");
const JsonString = jsonPrimitive("string");

module.exports = {
	JsonBoolean,
	JsonNumber,
	JsonString,

	jsonArray,
	jsonPrimitive,
};
