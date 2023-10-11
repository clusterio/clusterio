import { Type } from "@sinclair/typebox";

export function StringEnum<T extends string[]>(values: [...T]) {
	return Type.Unsafe<T[number]>({ type: "string", enum: values });
}

export interface JSONDeserialisable<T> {
	fromJSON(json: unknown): T;
	jsonSchema: object;
}

export function jsonArray<T>(ItemClass: JSONDeserialisable<T>) {
	return {
		jsonSchema: {
			type: "array",
			items: ItemClass.jsonSchema,
		},
		fromJSON(json: Array<T>) {
			return json.map(i => ItemClass.fromJSON(i));
		},
	};
}

export function jsonPrimitive<T, U>(type: U) {
	return {
		jsonSchema: { type },
		fromJSON(json: T) {
			return json;
		},
	};
}
export const JsonBoolean = jsonPrimitive<boolean, "boolean">("boolean");
export const JsonNumber = jsonPrimitive<number, "number">("number");
export const JsonString = jsonPrimitive<string, "string">("string");
