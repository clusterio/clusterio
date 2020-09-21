/**
 * Utilities for dealing with Lua
 * @module
 */
"use strict";

/**
 * Escapes a string for inclusion into a lua string
 *
 * @param {string} content - String to escape.
 * @returns {string} Escaped string.
 */
function escapeString(content) {
	return content
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/'/g, "\\'")
		.replace(/\0/g, "\\0")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
	;
}

module.exports = {
	escapeString,
};
