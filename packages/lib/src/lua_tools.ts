/**
 * Utilities for dealing with Lua
 * @module lib/lua_tools
 */

/**
 * A colour as it may originate from Factorio Lua code, see
 * https://lua-api.factorio.com/latest/types/Color.html
 */
export type FactorioColor = { r?: number, g?: number, b?: number, a?: number } | [number, number, number, number?];

export type Color = { r: number, g: number, b: number, a: number };

/**
 * Normalise a color as it may appear in Factorio Lua code to be an object
 * with r, g, b, a properties in the range 0 to 1.
 *
 * @param color -
 *     A colour that may be specified with left out components or as an
 *     array and have the range 1 to 0 or 255 to 0.
 * @returns
 *     Normalised colour where all 4 components are present as properties in
 *     the range 0 to 1.
 */
export function normalizeColor(color: FactorioColor) {
	let r, g, b, a;
	if (color instanceof Array) {
		([r, g, b, a] = color);
	} else {
		({ r, g, b, a } = color);
	}

	r ??= NaN;
	g ??= NaN;
	b ??= NaN;
	a ??= NaN;

	// Note NaN > 1 is false and NaN / 255 is NaN
	if (r > 1 || g > 1 || b > 1 || a > 1) {
		r /= 255;
		g /= 255;
		b /= 255;
		a /= 255;
	}

	return {
		r: Number.isNaN(r) ? 0 : r,
		g: Number.isNaN(g) ? 0 : g,
		b: Number.isNaN(b) ? 0 : b,
		a: Number.isNaN(a) ? 1 : a,
	};
}

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
