/**
 * Collection of small utilites that are useful in multiple places.
 * @module
 */
"use strict";

/**
 * Return a string describing the type of the value passed
 *
 * Works the same as typeof, excpet that null and array types get their
 * own string.
 *
 * @param {*} value - value to return the type of.
 * @returns {string} basic type of the value passed.
 */
function basicType(value) {
	if (value === null) { return "null"; }
	if (value instanceof Array) { return "array"; }
	return typeof value;
}

module.exports = {
	basicType,
};
