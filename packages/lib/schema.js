/**
 * JSON schemas used for validating link messages
 * @module lib/schema
 */
"use strict";
const Ajv = require("ajv");
const ajv = new Ajv({
	verbose: true,
	format: "full",
	extendRefs: "fail",
	strictDefaults: true,
	strictKeywords: true,
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
