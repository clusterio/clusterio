/**
 * JSON schemas used for validating link messages
 * @module lib/schema
 */
"use strict";
const Ajv = require("ajv");
const ajv = new Ajv({
	// These are duplicated in scripts/compile_validator
	allowUnionTypes: true,
	strict: "log",
	strictTuples: false,
	verbose: true,
});

/**
 * Compile JSON schema into validator
 * @function
 * @param {Object} schema - JSON schema to create validator for.
 * @returns {Function} Validator for the schema.
 */
function compile(schema) {
	if (typeof global !== "object" || !global.lazySchemaCompilation) {
		return ajv.compile(schema);
	}

	let doValidate;
	function validate(data) {
		if (!doValidate) {
			doValidate = ajv.compile(schema);
		}
		let result = doValidate(data);
		validate.errors = doValidate.errors;
		return result;
	}
	return validate;
}

module.exports = {
	compile,
};
