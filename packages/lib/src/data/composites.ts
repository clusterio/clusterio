import { TSchema, Type } from "@sinclair/typebox";

export function StringEnum<T extends string[]>(values: [...T]) {
	return Type.Unsafe<T[number]>({ type: 'string', enum: values })
}

export interface JSONDeserialisable<T> {
	fromJSON(json: unknown): T;
	jsonSchema: TSchema;
}

export function jsonArray<T>(ItemClass: JSONDeserialisable<T>) {
	return {
		jsonSchema: Type.Array(ItemClass.jsonSchema),
		fromJSON(json: Array<T>) {
			return json.map(i => ItemClass.fromJSON(i));
		},
	};
}

export function jsonPrimitive<T, U extends "boolean"|"number"|"string">(type: U) {
	let jsonSchema: TSchema;
	switch (type) {
		case "boolean": jsonSchema = Type.Boolean(); break;
		case "number": jsonSchema = Type.Number(); break;
		case "string": jsonSchema = Type.String(); break;
		default: throw new Error(`Unexpected jsonPrimitive type (${type}) expect one of "boolean"|"number"|"string"`);
	}

	return {
		jsonSchema,
		fromJSON(json: T) {
			return json;
		},
	};
}
export const JsonBoolean = jsonPrimitive<boolean, "boolean">("boolean");
export const JsonNumber = jsonPrimitive<number, "number">("number");
export const JsonString = jsonPrimitive<string, "string">("string");
