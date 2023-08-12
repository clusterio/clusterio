/**
 * Utilities for dealing with Lua
 * @module lib/lua_tools
 */

/**
 * Escapes a string for inclusion into a lua string
 *
 * @param content - String to escape.
 * @returns Escaped string.
 */
export function escapeString(content: string) {
	return content
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/'/g, "\\'")
		.replace(/\0/g, "\\0")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
	;
}
