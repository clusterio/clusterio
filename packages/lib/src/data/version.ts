/* eslint-disable no-template-curly-in-string */
// Helper functions for dealing with factorio version numbers

import { Static, Type } from "@sinclair/typebox";

/**
 * Integer representation of a version string.
 *
 * Suitable for sorting and comparing version numbers which may have different
 * number of leading zeros in them.
 */
export type IntegerVersion = number & { [integerVersionSymbol]: void };
declare const integerVersionSymbol: unique symbol;

/**
 * Allowed version equalities as defined within mod info json
 * https://lua-api.factorio.com/latest/auxiliary/mod-structure.html#Dependency
 */
const versionEqualities = ["<", "<=", "=", ">=", ">"] as const;
export const VersionEqualitySchema = Type.Union(versionEqualities.map(v => Type.Literal(v)));
export type VersionEquality = Static<typeof VersionEqualitySchema>;

export function isVersionEquality(input: string): input is VersionEquality {
	return versionEqualities.includes(input as any);
}

/**
 * Matches valid factorio versions accepts by the web API
 * https://wiki.factorio.com/Mod_portal_API#/api/mods (see version enum)
 */
export const ApiVersions = ["0.13", "0.14", "0.15", "0.16", "0.17", "0.18", "1.0", "1.1", "2.0"] as const;
export const ApiVersionSchema = Type.Union(ApiVersions.map(v => Type.Literal(v)));
export type ApiVersion = Static<typeof ApiVersionSchema>;

export function isApiVersion(input: string): input is ApiVersion {
	return ApiVersions.includes(input as any);
}

export function normaliseApiVersion(version: PartialVersion) {
	const parts = version.split(".");
	const apiVersion = `${parts[0]}.${parts[1]}`;
	if (!isApiVersion(apiVersion)) {
		throw new Error(`Version is not accepted by factorio api: ${version}`);
	}
	return apiVersion;
}

/**
 * Matches valid mod versions, where all parts are specified.
 */
const fullVersionRegExp = /^\d+\.\d+\.\d+$/;
export type FullVersion = Static<typeof FullVersionSchema>;
export const FullVersionSchema = Type.TemplateLiteral("${number}.${number}.${number}");

export function isFullVersion(input: string): input is FullVersion {
	return fullVersionRegExp.test(input);
}

export function integerFullVersion(version: FullVersion) {
	const [major, minor, sub] = version.split(".").map(n => Number.parseInt(n, 10));
	// Can't use bitwise here because this is 48-bits.
	return major * 0x100000000 + minor * 0x10000 + sub as IntegerVersion;
}

export function normaliseFullVersion(version: PartialVersion) {
	const parts = version.split(".");
	return (parts.length === 3 ? version : `${version}.0`) as FullVersion;
}

/**
 * Matches valid factorio versions and mod dependencies specifications where 2 or 3 parts are specified.
 */
const partialVersionRegExp = /^\d+\.\d+(?:\.\d+)?$/;
export type PartialVersion = Static<typeof PartialVersionSchema>;
export const PartialVersionSchema = Type.Union([
	Type.TemplateLiteral("${number}.${number}.${number}"),
	Type.TemplateLiteral("${number}.${number}"),
]);

export function isPartialVersion(input: string): input is PartialVersion {
	return partialVersionRegExp.test(input);
}

export function integerPartialVersion(version: PartialVersion) {
	const [major, minor, sub] = version.split(".").map(n => Number.parseInt(n, 10));
	// Can't use bitwise here because this is 48-bits. sub is optional and defaults to 0.
	return major * 0x100000000 + minor * 0x10000 + (sub || 0) as IntegerVersion;
}

/**
 * Matches valid factorio target versions, this is the same as partial but also accepts "latest".
 */
export type TargetVersion = Static<typeof TargetVersionSchema>;
export const TargetVersionSchema = Type.Union([
	Type.TemplateLiteral("${number}.${number}.${number}"),
	Type.TemplateLiteral("${number}.${number}"),
	Type.Literal("latest"),
]);

export function isTargetVersion(input: string): input is TargetVersion {
	return input === "latest" || partialVersionRegExp.test(input);
}

/**
 * Represents a mod version paired with an equality which can be tested against
 */
export class ModVersionEquality {
	constructor(
		public equality: VersionEquality,
		public integerVersion: IntegerVersion,
	) { }

	testIntegerVersion(other: IntegerVersion) {
		switch (this.equality) {
			case "<":
				return other < this.integerVersion;
			case "<=":
				return other <= this.integerVersion;
			case "=":
				return other === this.integerVersion;
			case ">=":
				return other >= this.integerVersion;
			case ">":
				return other > this.integerVersion;
			default:
				throw new Error("unreachable");
		}
	}

	testVersion(version: PartialVersion) {
		return this.testIntegerVersion(integerPartialVersion(version));
	}

	static fromString(version: string) {
		const parts = version.split(" ");
		return parts.length === 1 ? this.fromParts("=", parts[0]) : this.fromParts(parts[0], parts[1]);
	}

	static fromParts(equality: string, version: string) {
		if (!isVersionEquality(equality)) {
			throw new Error(`Unknown version equality: ${equality}`);
		}
		if (!isPartialVersion(version)) {
			throw new Error(`Malformed version string: ${version}`);
		}
		return new this(equality, integerPartialVersion(version));
	}
}
