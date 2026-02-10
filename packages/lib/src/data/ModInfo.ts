import fs from "fs-extra";
import JSZip from "jszip";
import { Type, Static } from "@sinclair/typebox";

import * as libHash from "../hash";
import * as libSchema from "../schema";
import { findRoot } from "../zip_ops";
import { ModRecord } from "./ModPack";

import {
	ApiVersion,
	ApiVersionSchema,
	FullVersion, FullVersionSchema, integerFullVersion,
	integerPartialVersion,
	ModVersionEquality,
} from "./version";

type ModDependencyType = "incompatible" | "optional" | "hidden" | "unordered" | "required";

export type ModDependencyUnsatisfiedReason = "incompatible" | "missing_dependency" | "wrong_version";
const UnsatisfiedSeverity: Record<ModDependencyUnsatisfiedReason, number> = {
	"incompatible": 1, "missing_dependency": 2, "wrong_version": 3,
};

const depSpecRegex = /^(?:(\?|\(\?\)|!|~|\+) *)?(.+?)(?: *([<>]=?|=) *([0-9.]+))?$/;

export class ModDependency {
	public spec: string;
	public name: string;
	public type: ModDependencyType;
	public version: ModVersionEquality | undefined;

	static getTypeFromPrefix(prefix: string): ModDependencyType {
		switch (prefix) {
			case "!":
				return "incompatible";
			case "?":
				return "optional";
			case "(?)":
				return "hidden";
			case "~":
				return "unordered";
			case "":
				return "required";
			default:
				throw new Error(`Invalid dependency prefix "${prefix}"`);
		}
	}

	constructor (
		specification: string,
	) {
		const match = depSpecRegex.exec(specification);
		if (match === null) {
			throw new Error(`Invalid dependency specification "${specification}"`);
		}

		// Expand the match to the different parts
		const [spec, type, name, equality, version] = match;
		this.type = ModDependency.getTypeFromPrefix(type ?? "");
		this.spec = spec;
		this.name = name;

		// Parse the equality and version
		if ((equality || version) && !this.incompatible) {
			this.version = ModVersionEquality.fromParts(equality, version);
		}
	}

	checkUnsatisfiedReason(mods: (ModInfo | ModRecord)[]): ModDependencyUnsatisfiedReason | undefined {
		const mod = mods.find(m => m.name === this.name);
		if (mod === undefined) {
			return ["unordered", "required"].includes(this.type) ? "missing_dependency" : undefined;
		} else if (this.type === "incompatible") {
			return "incompatible";
		} else if (this.version && !this.version.testVersion(mod.version)) {
			return "wrong_version";
		}
		return undefined;
	}

	isSatisfied(mods: (ModInfo | ModRecord)[]) {
		return this.checkUnsatisfiedReason(mods) === undefined;
	}

	get incompatible() {
		return this.type === "incompatible";
	}

	get required() {
		return this.type === "unordered" || this.type === "required";
	}

	get optional() {
		return this.type === "hidden" || this.type === "optional";
	}

	static jsonSchema = Type.String();

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json);
	}

	toJSON() {
		return this.spec;
	}
}

/**
 * Info about a mod available on the controller.
 *
 * See https://wiki.factorio.com/Tutorial:Mod_structure#info.json for
 * details of the invidiual fields sourced from info.json.
 */
export default class ModInfo {
	/**
	 * String containing {mod.name}_{mod.version}, uniquely identifies this
	 * mod.
	 */
	get id() {
		return `${this.name}_${this.version}`;
	}

	/**
	 * Internal name of this mod.
	 * This is the name of the zip file as well as the name that appears in
	 * info.json.
	 */
	name = "";

	/**
	 * Version of the mod.
	 * Sourced from info.json.
	 */
	version = "0.0.0" as FullVersion;

	/**
	 * Integer representation of the version
	 */
	get integerVersion() {
		return integerFullVersion(this.version);
	}

	/**
	 * Display name of the mod.
	 * Sourced from info.json.
	 */
	title = "";

	/**
	 * Author of the mod.
	 * Sourced from info.json.
	 */
	author = "";

	/**
	 * Contact field for mod.
	 * Sourced from info.json.
	 */
	contact = "";

	/**
	 * Homepage of the mod.
	 * Sourced from info.json.
	 */
	homepage = "";

	/**
	 * Description of the mod.
	 * Sourced from info.json.
	 */
	description = "";

	/**
	 * Major version of Factorio this mod supports.
	 * Sourced from info.json.
	 */
	factorioVersion = "0.12" as "0.12" | ApiVersion;

	/**
	 * Integer representation of the factorioVersion
	 * @type {number}
	 */
	get integerFactorioVersion() {
		return integerPartialVersion(this.factorioVersion);
	}

	/**
	 * Dependencies for this mod.
	 * Sourced from info.json.
	 */
	dependencies = [new ModDependency("base")];

	/**
	 * Dependencies for this mod.
	 * As they would be represented in info.json.
	 */
	get dependencySpecifications() {
		return this.dependencies.map(d => d.spec);
	}

	checkDependencySatisfaction(mods: (ModInfo | ModRecord)[]) {
		return this.dependencies
			.map(d => d.checkUnsatisfiedReason(mods))
			.filter((v): v is ModDependencyUnsatisfiedReason => Boolean(v))
			.reduce<ModDependencyUnsatisfiedReason | undefined>((max, current) => (
				!max || UnsatisfiedSeverity[max] > UnsatisfiedSeverity[current] ? current : max
			), undefined);
	}

	/**
	 * Expected name of zip file containing this mod.
	 */
	get filename() {
		return ModInfo.filename(this.name, this.version);
	}

	/**
	 * Expected name of zip file containing mod with given name and version.
	 * @param name - Mod's name
	 * @param version - Mod's version
	 * @returns string containing {name}_{version}.zip
	 */
	static filename(name: string, version: FullVersion) {
		return `${name}_${version}.zip`;
	}

	/**
	 * Size of the mod in bytes
	 */
	size = 0;

	/**
	 * Last modification time of the file.
	 */
	mtimeMs = 0;

	/**
	 * SHA1 hash of this mod
	 */
	sha1?: string;

	/** Millisecond Unix timestamp this entry was last updated at */
	updatedAtMs = 0;

	/**
	 * True if this mod has been deleted
	 */
	isDeleted = false;

	// Content of info.json found in mod files
	static infoJsonSchema = Type.Object({
		"name": Type.String(),
		"version": FullVersionSchema,
		"title": Type.String(),
		"author": Type.String(),
		"contact": Type.Optional(Type.String()),
		"homepage": Type.Optional(Type.String()),
		"description": Type.Optional(Type.String()),
		"factorio_version": Type.Optional(ApiVersionSchema),
		"dependencies": Type.Optional(Type.Array(Type.String())),
	});

	static validateInfo = libSchema.compile<Static<typeof this.infoJsonSchema>>(this.infoJsonSchema as any);

	static jsonSchema = Type.Object({
		...this.infoJsonSchema.properties,
		"size": Type.Optional(Type.Integer()),
		"mtime_ms": Type.Optional(Type.Number()),
		"sha1": Type.Optional(Type.String()),
		"updated_at_ms": Type.Optional(Type.Number()),
		"is_deleted": Type.Optional(Type.Boolean()),
	});

	static validate = libSchema.compile(this.jsonSchema as any);

	static fromJSON(json: Static<typeof ModInfo.jsonSchema>) {
		const modInfo = new this();

		// info.json fields
		if (json.name) { modInfo.name = json.name; }
		if (json.version) { modInfo.version = json.version; }
		if (json.title) { modInfo.title = json.title; }
		if (json.author) { modInfo.author = json.author; }
		if (json.contact) { modInfo.contact = json.contact; }
		if (json.homepage) { modInfo.homepage = json.homepage; }
		if (json.description) { modInfo.description = json.description; }
		if (json.factorio_version) { modInfo.factorioVersion = json.factorio_version; }

		// Parse the dependencies
		try {
			if (json.dependencies) { modInfo.dependencies = json.dependencies.map(d => new ModDependency(d)); }
		} catch (err: any) {
			throw new Error(`Failed for parse dependencies for ${json.name}: ${err}`);
		}

		// Additional data
		if (json.size) { modInfo.size = json.size; }
		if (json.mtime_ms) { modInfo.mtimeMs = json.mtime_ms; }
		if (json.sha1) { modInfo.sha1 = json.sha1; }
		if (json.updated_at_ms) { modInfo.updatedAtMs = json.updated_at_ms; }
		if (json.is_deleted) { modInfo.isDeleted = json.is_deleted; }

		return modInfo;
	}

	toJSON() {
		let json: Static<typeof ModInfo.jsonSchema> = {
			name: this.name,
			version: this.version,
			title: this.title,
			author: this.author,
		};
		if (this.contact) { json.contact = this.contact; }
		if (this.homepage) { json.homepage = this.homepage; }
		if (this.description) { json.description = this.description; }
		if (this.factorioVersion !== "0.12") { json.factorio_version = this.factorioVersion; }
		if (this.dependencies.length !== 1 || this.dependencies[0].name !== "base") {
			json.dependencies = this.dependencySpecifications;
		}
		if (this.size) { json.size = this.size; }
		if (this.mtimeMs) { json.mtime_ms = this.mtimeMs; }
		if (this.sha1) { json.sha1 = this.sha1; }
		if (this.updatedAtMs) { json.updated_at_ms = this.updatedAtMs; }
		if (this.isDeleted) { json.is_deleted = this.isDeleted; }
		return json;
	}

	static async fromModFile(modPath: string) {
		let modInfo: Static<typeof ModInfo.jsonSchema>;
		{
			// XXX: JSZip needs the whole archive loaded in memory to work.
			// This is clearly untenable and will be replaced later.
			let zip = await JSZip.loadAsync(await fs.readFile(modPath));
			let root = zip.folder(findRoot(zip))!;

			let infoFile = root.file("info.json");
			if (!infoFile) {
				throw new Error("Mod contains no info.json file");
			}

			modInfo = JSON.parse(await infoFile.async("string"));
		}

		let valid = this.validateInfo(modInfo);
		if (!valid) {
			throw new Error("Mod's info.json is not valid");
		}

		const stat = await fs.stat(modPath);
		return this.fromJSON({
			...modInfo,

			size: stat.size,
			sha1: await libHash.hashFile(modPath),
			mtime_ms: stat.mtimeMs,
			updated_at_ms: stat.mtimeMs,
			is_deleted: false,
		});
	}
}
