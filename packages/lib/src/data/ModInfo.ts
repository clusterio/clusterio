import fs from "fs-extra";
import JSZip from "jszip";
import { Type, Static } from "@sinclair/typebox";

import * as libHash from "../hash";
import * as libSchema from "../schema";
import { findRoot } from "../zip_ops";

import { integerModVersion, integerFactorioVersion, modVersionRegExp } from "./version";


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
	version = "";

	/**
	 * Integer representation of the version
	 */
	get integerVersion() {
		return integerModVersion(this.version);
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
	factorioVersion = "0.12";

	/**
	 * Integer representation of the factorioVersion
	 * @type {number}
	 */
	get integerFactorioVersion() {
		return integerFactorioVersion(this.factorioVersion);
	}

	/**
	 * Dependiences for this mod.
	 * Sourced from info.json.
	 */
	dependencies = ["base"];

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
	static filename(name: string, version: string) {
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
		"version": Type.String(),
		"title": Type.String(),
		"author": Type.String(),
		"contact": Type.Optional(Type.String()),
		"homepage": Type.Optional(Type.String()),
		"description": Type.Optional(Type.String()),
		"factorio_version": Type.Optional(Type.String()),
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
		if (json.dependencies) { modInfo.dependencies = json.dependencies; }

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
		if (this.dependencies.length !== 1 || this.dependencies[0] !== "base") {
			json.dependencies = this.dependencies;
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

		if (!modVersionRegExp.test(modInfo.version)) {
			throw new Error(`Mod's version (${modInfo.version}) is invalid`);
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
