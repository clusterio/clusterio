/**
 * JSON schemas used for validating link messages
 * @module lib/schema
 */
import Ajv, { ValidateFunction } from "ajv";
import { TSchema } from "@sinclair/typebox";

const ajv = new Ajv({
	// These are duplicated in scripts/compile_validator
	allowUnionTypes: true,
	strict: "log",
	strictTuples: false,
	verbose: true,
});

/**
 * Compile JSON schema into validator
 * @param schema - JSON schema to create validator for.
 * @returns Validator for the schema.
 */
export function compile<T>(schema: TSchema): ValidateFunction<T> {
	if (typeof global !== "object" || !(global as any).lazySchemaCompilation) {
		return ajv.compile<T>(schema);
	}

	let doValidate: ValidateFunction<T>;
	const validate = <ValidateFunction<T>>function (data) {
		if (!doValidate) {
			doValidate = ajv.compile(schema);
		}
		let result = doValidate(data);
		validate.errors = doValidate.errors;
		return result;
	}
	return validate;
}
