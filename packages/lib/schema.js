/**
 * JSON schemas used for validating link messages
 * @module lib/schema
 */
"use strict";
const Ajv = require("ajv");
const ajv = new Ajv({
	allowUnionTypes: true,
	strict: "log",
	strictTuples: false,
	verbose: true,
});

module.exports = {
	/**
	 * Compile JSON schema into validator
	 * @function
	 * @param {Object} schema - JSON schema to create validator for.
	 * @returns {Function} Validator for the schema.
	 */
	compile: ajv.compile.bind(ajv),
};
