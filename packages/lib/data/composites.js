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

module.exports = {
	JsonBoolean: jsonPrimitive("boolean"),
	JsonNumber: jsonPrimitive("number"),
	JsonString: jsonPrimitive("string"),

	jsonArray,
	jsonPrimitive,
};
