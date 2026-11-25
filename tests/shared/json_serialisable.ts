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

/**
 * A value matching a schema, with a description of what makes it differ from
 * the default value. The default value has an empty description.
 */
type Sample = [description: string, value: unknown];

// Strings tried in order for a schema with a pattern
const patternCandidates = ["a", "1", "1.0", "1.0.0", "a-b", "a.b", "a_b", "A", "ffffff", "0.0.0"];

/**
 * Create JSON values matching a JSON schema.
 *
 * The first value is the default, the rest each change one place in it to
 * cover every branch of a union, every enum value and every known sample.
 * Only required properties are created unless `full` is set, in which case
 * every declared property is created. Throws for schemas it cannot satisfy,
 * these need a hand written sample in `known` instead.
 *
 * @param schema - JSON schema to create values for.
 * @param full - Include optional properties.
 * @param known - Samples to use for specific schema objects, wherever they appear.
 * @param path - JSON pointer to the schema, used in the descriptions.
 * @returns Default value followed by its variations.
 */
export function schemaSamples(schema: any, full = false, known?: KnownSamples, path = ""): Sample[] {
	if (known?.has(schema)) {
		const values = known.get(schema)!;
		const first = full ? values.length - 1 : 0;
		return [
			["", structuredClone(values[first])],
			...values.flatMap((value, index): Sample[] => (
				index === first ? [] : [[`${path || "/"} as known sample ${index + 1}`, structuredClone(value)]]
			)),
		];
	}
	if (schema === true || schema === undefined || Object.keys(schema).length === 0) {
		return [["", null]];
	}
	if ("const" in schema) {
		return [["", schema.const]];
	}
	if (schema.enum) {
		return schema.enum.map((value: unknown, index: number): Sample => [
			index ? `${path || "/"} = ${JSON.stringify(value)}` : "", value,
		]);
	}
	if ("default" in schema) {
		return [["", structuredClone(schema.default)]];
	}
	const branches = schema.anyOf ?? schema.oneOf
		?? (Array.isArray(schema.type) ? schema.type.map((type: string) => ({ ...schema, type })) : undefined);
	if (branches) {
		return unionSamples(branches, full, known, path);
	}
	if (schema.allOf) {
		return [["", Object.assign({}, ...schema.allOf.map((s: any) => sampleFromSchema(s, full, known)))]];
	}
	return typeSamples(schema, full, known, path);
}

function unionSamples(branches: any[], full: boolean, known: KnownSamples | undefined, path: string) {
	// Prefer a branch that is not null for the default so it says more
	const defaultIndex = Math.max(0, branches.findIndex(s => s.type !== "null"));
	const samples: Sample[] = [];
	branches.forEach((branch, index) => {
		const branchPath = `${path}<${index + 1}>`;
		for (const [description, value] of schemaSamples(branch, full, known, branchPath)) {
			if (index === defaultIndex) {
				samples.push([description, value]);
			} else {
				samples.push([description || `${path || "/"} as branch ${index + 1}`, value]);
			}
		}
	});
	const defaultSample = samples.findIndex(([description]) => description === "");
	return [samples[defaultSample], ...samples.filter((_, index) => index !== defaultSample)];
}

function typeSamples(schema: any, full: boolean, known: KnownSamples | undefined, path: string): Sample[] {
	switch (schema.type) {
		case "null":
			return [["", null]];
		case "boolean":
			return [["", false], [`${path || "/"} = true`, true]];
		case "integer":
		case "number":
			return [["", schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 0)]];
		case "string":
			return [["", sampleString(schema)]];
		case "array":
			return arraySamples(schema, full, known, path);
		case "object":
			return objectSamples(schema, full, known, path);
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

/**
 * Combine the samples of each part into a default value and one variation
 * per non-default sample of a part, with the other parts at their default.
 */
function combine<K extends string | number>(
	parts: [K, Sample[]][],
	build: (values: Map<K, unknown>) => unknown,
): Sample[] {
	const defaults = new Map(parts.map(([key, samples]) => [key, samples[0][1]]));
	const result: Sample[] = [["", build(defaults)]];
	for (const [key, samples] of parts) {
		for (const [description, value] of samples.slice(1)) {
			result.push([description, build(new Map(defaults).set(key, value))]);
		}
	}
	return result;
}

function arraySamples(schema: any, full: boolean, known: KnownSamples | undefined, path: string) {
	if (Array.isArray(schema.items) || schema.prefixItems) {
		const items: any[] = schema.prefixItems ?? schema.items;
		const count = full ? items.length : schema.minItems ?? 0;
		const parts = items.slice(0, count).map((item, index): [number, Sample[]] => (
			[index, schemaSamples(item, full, known, `${path}/${index}`)]
		));
		return combine(parts, values => [...values.values()]);
	}
	const count = Math.max(schema.minItems ?? 0, full ? 1 : 0);
	if (count === 0) {
		return [["", []]] as Sample[];
	}
	// Variations of the items are only tried in the first one
	const first = schemaSamples(schema.items, full, known, `${path}/0`);
	const parts = Array.from({ length: count }, (_, index): [number, Sample[]] => (
		[index, index ? first.slice(0, 1) : first]
	));
	return combine(parts, values => [...values.values()]);
}

function objectSamples(schema: any, full: boolean, known: KnownSamples | undefined, path: string) {
	const required = new Set<string>(schema.required ?? []);
	const parts = Object.entries(schema.properties ?? {})
		.filter(([key]) => full || required.has(key))
		.map(([key, property]): [string, Sample[]] => [key, schemaSamples(property, full, known, `${path}/${key}`)]);
	return combine(parts, values => Object.fromEntries(values));
}

/**
 * Create a JSON value matching a JSON schema, see {@link schemaSamples}.
 *
 * @param schema - JSON schema to create a value for.
 * @param full - Include optional properties.
 * @param known - Samples to use for specific schema objects, wherever they appear.
 * @returns Value matching the schema.
 */
export function sampleFromSchema(schema: any, full = false, known?: KnownSamples): unknown {
	return schemaSamples(schema, full, known)[0][1];
}

/**
 * JSON samples for a class generated from its schema: a minimal and a full
 * sample, then a variation for every union branch, enum value and known
 * sample reachable from either.
 *
 * @param Class - Class to create samples for.
 * @param known - Hand written samples for schemas that cannot be generated.
 * @returns Named JSON samples.
 */
export function jsonSamples(Class: JsonSerialisableClass, known?: KnownSamples) {
	const minimal = schemaSamples(Class.jsonSchema, false, known);
	const full = schemaSamples(Class.jsonSchema, true, known);
	const samples: [string, unknown][] = [["minimal sample", minimal[0][1]], ["full sample", full[0][1]]];
	const seen = new Set(samples.map(([, value]) => JSON.stringify(value)));
	for (const [base, variations] of [["minimal", minimal], ["full", full]] as const) {
		for (const [description, value] of variations.slice(1)) {
			const json = JSON.stringify(value);
			if (!seen.has(json)) {
				seen.add(json);
				samples.push([`${base} sample with ${description}`, value]);
			}
		}
	}
	return samples;
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
