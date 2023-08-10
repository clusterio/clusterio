// Helper functions for dealing with factorio version numbers


/**
 * Integer representation of a mod version
 *
 * Suitable for sorting and comparing version numbers which may have different
 * number of leading zeros in them.
 * @param version - string representation of version.
 * @returns numeric representation.
 */
export function integerModVersion(version: string) {
	const [major, minor, sub] = version.split(".").map(n => Number.parseInt(n, 10));
	return major * 0x100000000 + minor * 0x10000 + sub; // Can't use bitwise here because this is 48-bits.
}

/**
 * Integer representation of a factorio version
 *
 * Suitable for sorting and comparing version numbers which may have different
 * number of leading zeros in them.
 * @param version - string representation of version.
 * @returns numeric representation.
 */
export function integerFactorioVersion(version: string) {
	const [main, major, minor] = version.split(".").map(n => Number.parseInt(n, 10));
	return main * 0x100000000 + major * 0x10000 + (minor || 0); // Can't use bitwise here because this is 48-bits.
}

/**
 * Matches valid mod versions.
 */
export const modVersionRegExp = /^\d+\.\d+\.\d+$/;
