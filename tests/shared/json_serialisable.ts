import type { Test } from "tap";
import { compile } from "@clusterio/lib";

/** A class following the JSON serialisable data class pattern, see docs/devs/json-serialisable-classes.md */
export interface JsonSerialisableClass {
	name: string;
	jsonSchema: object;
	fromJSON(json: any): any;
}

export function isJsonSerialisableClass(value: unknown): value is JsonSerialisableClass {
	return typeof value === "function"
		&& typeof (value as any).jsonSchema === "object"
		&& typeof (value as any).fromJSON === "function";
}

/**
 * Collect the JSON serialisable classes exported by a module, including the
 * Response classes of messages that are not exported on their own.
 *
 * @param module - Module namespace to search.
 * @returns Map of display name to class.
 */
export function jsonSerialisableClasses(module: Record<string, unknown>) {
	const classes = new Map<string, JsonSerialisableClass>();
	const exported = new Set(Object.values(module));
	for (const [name, value] of Object.entries(module)) {
		if (isJsonSerialisableClass(value)) {
			classes.set(name, value);
		}
		const response = (value as any)?.Response;
		if (typeof value === "function" && isJsonSerialisableClass(response) && !exported.has(response)) {
			classes.set(`${name}.Response`, response);
		}
	}
	return classes;
}

/** Hand written JSON samples keyed by the schema object they match, minimal first and full last */
export type KnownSamples = Map<object, unknown[]>;

// Strings tried in order for a schema with a pattern
const patternCandidates = ["a", "1", "1.0", "1.0.0", "a-b", "a.b", "a_b", "A", "ffffff", "0.0.0"];

/**
 * Create a JSON value matching a JSON schema.
 *
 * Only required properties are created unless `full` is set, in which case
 * every declared property is created. Throws for schemas it cannot satisfy,
 * these need a hand written sample in `known` instead.
 *
 * @param schema - JSON schema to create a value for.
 * @param full - Include optional properties.
 * @param known - Samples to use for specific schema objects, wherever they appear.
 * @returns Value matching the schema.
 */
export function sampleFromSchema(schema: any, full = false, known?: KnownSamples): unknown {
	if (known?.has(schema)) {
		const samples = known.get(schema)!;
		return structuredClone(full ? samples.at(-1) : samples[0]);
	}
	if (schema === true || schema === undefined || Object.keys(schema).length === 0) {
		return null;
	}
	if ("const" in schema) {
		return schema.const;
	}
	if (schema.enum) {
		return schema.enum[0];
	}
	if ("default" in schema) {
		return structuredClone(schema.default);
	}
	for (const key of ["anyOf", "oneOf"]) {
		if (schema[key]) {
			// Prefer a branch that is not null so the sample says more
			const branch = schema[key].find((s: any) => s.type !== "null") ?? schema[key][0];
			return sampleFromSchema(branch, full, known);
		}
	}
	if (schema.allOf) {
		return Object.assign({}, ...schema.allOf.map((s: any) => sampleFromSchema(s, full, known)));
	}

	const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== "null") : schema.type;
	switch (type) {
		case "null":
			return null;
		case "boolean":
			return false;
		case "integer":
		case "number":
			return schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 0);
		case "string":
			return sampleString(schema);
		case "array":
			return sampleArray(schema, full, known);
		case "object":
			return sampleObject(schema, full, known);
		default:
			throw new Error(`Unsupported schema ${JSON.stringify(schema)}`);
	}
}

function sampleString(schema: any) {
	if (schema.pattern) {
		const pattern = new RegExp(schema.pattern, "u");
		const match = patternCandidates.find(c => pattern.test(c));
		if (match === undefined) {
			throw new Error(`No sample string matches pattern ${schema.pattern}`);
		}
		return match;
	}
	if (schema.format) {
		throw new Error(`No sample string for format ${schema.format}`);
	}
	return "a".repeat(schema.minLength ?? 0);
}

function sampleArray(schema: any, full: boolean, known?: KnownSamples) {
	if (Array.isArray(schema.items) || schema.prefixItems) {
		const items: any[] = schema.prefixItems ?? schema.items;
		const count = full ? items.length : schema.minItems ?? 0;
		return items.slice(0, count).map(item => sampleFromSchema(item, full, known));
	}
	const count = Math.max(schema.minItems ?? 0, full ? 1 : 0);
	return Array.from({ length: count }, () => sampleFromSchema(schema.items, full, known));
}

function sampleObject(schema: any, full: boolean, known?: KnownSamples) {
	const required = new Set<string>(schema.required ?? []);
	const result: Record<string, unknown> = {};
	for (const [key, property] of Object.entries(schema.properties ?? {})) {
		if (full || required.has(key)) {
			result[key] = sampleFromSchema(property, full, known);
		}
	}
	return result;
}

/**
 * Minimal and full JSON samples for a class generated from its schema.
 *
 * @param Class - Class to create samples for.
 * @param known - Hand written samples for schemas that cannot be generated.
 * @returns Named JSON samples.
 */
export function jsonSamples(Class: JsonSerialisableClass, known?: KnownSamples) {
	return [
		["minimal sample", sampleFromSchema(Class.jsonSchema, false, known)],
		["full sample", sampleFromSchema(Class.jsonSchema, true, known)],
	] as const;
}

/**
 * Common tests for a JSON serialisable class.
 *
 * Each sample is deserialised with fromJSON, serialised with JSON.stringify,
 * then checked against the class schema and deserialised again.
 *
 * @param t - Test to add the fromJSON() and toJSON() subtests to.
 * @param Class - Class under test.
 * @param samples - Named JSON samples, see {@link jsonSamples}.
 */
export function testJsonSerialisable(
	t: Test,
	Class: JsonSerialisableClass,
	samples: ReadonlyArray<readonly [string, unknown]>,
) {
	const validate = compile(Class.jsonSchema as any);
	const serialise = (value: unknown) => JSON.parse(JSON.stringify(value));

	t.test("toJSON()", async t1 => {
		for (const [name, json] of samples) {
			t1.test(`matches jsonSchema for ${name}`, async t2 => {
				const serialised = serialise(Class.fromJSON(structuredClone(json)));
				t2.ok(validate(serialised), "serialised value is valid", { errors: validate.errors, serialised });
			});
		}
	});

	t.test("fromJSON()", async t1 => {
		for (const [name, json] of samples) {
			t1.test(`round trips ${name}`, async t2 => {
				const original = Class.fromJSON(structuredClone(json));
				const reconstructed = Class.fromJSON(serialise(original));
				t2.strictSame(reconstructed, original);
				t2.same(serialise(reconstructed), serialise(original));
			});
		}
	});
}
