/**
 * Escapes a string for inclusion into a lua string
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
}
