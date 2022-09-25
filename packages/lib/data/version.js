// Helper functions for dealing with factorio version numbers
"use strict";


/**
 * Integer representation of a mod version
 *
 * Suitable for sorting and comparing version numbers which may have different
 * number of leading zeros in them.
 * @param {string} version - string representation of version.
 * @returns {number} numeric representation.
 * @private
 */
function integerModVersion(version) {
	const [major, minor, sub] = version.split(".").map(n => Number.parseInt(n, 10));
	return major * 0x100000000 + minor * 0x10000 + sub; // Can't use bitwise here because this is 48-bits.
}

/**
 * Integer representation of a factorio version
 *
 * Suitable for sorting and comparing version numbers which may have different
 * number of leading zeros in them.
 * @param {string} version - string representation of version.
 * @returns {number} numeric representation.
 * @private
 */
function integerFactorioVersion(version) {
	const [major, minor, sub] = version.split(".").map(n => Number.parseInt(n, 10));
	return major * 0x100000000 + minor * 0x10000 + (sub || 0); // Can't use bitwise here because this is 48-bits.
}

/**
 * Matches valid mod versions.
 * @type {RegExp}
 * @private
 */
const modVersionRegExp = /^\d+\.\d+\.\d+$/;

module.exports = {
	integerModVersion,
	integerFactorioVersion,
	modVersionRegExp,
};
