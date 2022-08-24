"use strict";
const fs = require("fs-extra");
const JSZip = require("jszip");
const path = require("path");

const libHash = require("../hash");
const libSchema = require("../schema");
const { findRoot } = require("../zip_ops");


/**
 * Info about a mod available on the master server.
 *
 * See https://wiki.factorio.com/Tutorial:Mod_structure#info.json for
 * details of the invidiual fields sourced from info.json.
 * @alias module:lib/data/ModInfo
 */
class ModInfo {
	/**
	 * Internal name of this mod.
	 * This is the name of the zip file as well as the name that appears in
	 * info.json.
	 * @type {string}
	 */
	name = "";

	/**
	 * Version of the mod.
	 * Sourced from info.json.
	 * @type {string}
	 */
	version = "";

	/**
	 * Integer representation of the version
	 * @type {number}
	 */
	get integerVersion() {
		const [major, minor, sub] = this.version.split(".").map(n => Number.parseInt(n, 10));
		return major * 0x100000000 + minor * 0x10000 + sub; // Can't use bitwise here because this is 48-bits.
	}

	/**
	 * Display name of the mod.
	 * Sourced from info.json.
	 * @type {string}
	 */
	title = "";

	/**
	 * Author of the mod.
	 * Sourced from info.json.
	 * @type {string}
	 */
	author = "";

	/**
	 * Contact field for mod.
	 * Sourced from info.json.
	 * @type {string}
	 */
	contact = "";

	/**
	 * Homepage of the mod.
	 * Sourced from info.json.
	 * @type {string}
	 */
	homepage = "";

	/**
	 * Description of the mod.
	 * Sourced from info.json.
	 * @type {string}
	 */
	description = "";

	/**
	 * Major version of Factorio this mod supports.
	 * Sourced from info.json.
	 * @type {string}
	 */
	factorioVersion = "0.12";

	/**
	 * Integer representation of the factorioVersion
	 * @type {number}
	 */
	get integerFactorioVersion() {
		const [major, minor] = this.factorioVersion.split(".").map(n => Number.parseInt(n, 10));
		return major * 0x100000000 + minor * 0x10000; // Can't use bitwise here because this is 48-bits.
	}

	/**
	 * Dependiences for this mod.
	 * Sourced from info.json.
	 * @type {Array<string>}
	 */
	dependencies = ["base"];

	/**
	 * Name of the file containing this mod.
	 * @type {number}
	 */
	filename = "";

	/**
	 * Size of the mod in bytes
	 * @type {number}
	 */
	size = 0;

	/**
	 * Hash of this mod
	 * @type {string=}
	 */
	hash;

	/**
	 * True if this mod has been deleted
	 * @type {boolean}
	 */
	isDeleted = false;

	// Content of info.json found in mod files
	static infoJsonSchema = {
		type: "object",
		required: ["name", "version", "title", "author"],
		properties: {
			"name": { type: "string" },
			"version": { type: "string" },
			"title": { type: "string" },
			"author": { type: "string" },
			"contact": { type: "string" },
			"homepage": { type: "string" },
			"description": { type: "string" },
			"factorio_version": { type: "string" },
			"dependencies": { type: "array", items: { type: "string" } },
		},
	};

	static validateInfo = libSchema.compile(this.infoJsonSchema);

	static jsonSchema = {
		type: "object",
		properties: {
			...this.infoJsonSchema.properties,
			"filename": { type: "string" },
			"size": { type: "integer" },
			"hash": { type: "string" },
			"is_deleted": { type: "boolean" },
		},
	};

	static validate = libSchema.compile(this.jsonSchema);

	constructor(json = {}) {
		// info.json fields
		if (json.name) { this.name = json.name; }
		if (json.version) { this.version = json.version; }
		if (json.title) { this.title = json.title; }
		if (json.author) { this.author = json.author; }
		if (json.contact) { this.contact = json.contact; }
		if (json.homepage) { this.homepage = json.homepage; }
		if (json.description) { this.description = json.description; }
		if (json.factorio_version) { this.factorioVersion = json.factorio_version; }
		if (json.dependencies) { this.dependencies = json.dependencies; }

		// Additional data
		if (json.filename) { this.filename = json.filename; }
		if (json.size) { this.size = json.size; }
		if (json.hash) { this.hash = json.hash; }
		if (json.is_deleted) { this.isDeleted = json.is_deleted; }
	}

	toJSON() {
		let json = {
			name: this.name,
			version: this.version,
			title: this.title,
			author: this.author,
		};
		if (this.contact) { json.contact = this.contact; }
		if (this.homepage) { json.homepage = this.homepage; }
		if (this.description) { json.description = this.description; }
		if (this.factorio_version !== "0.12") { json.factorio_version = this.factorioVersion; }
		if (this.dependencies.length !== 1 || this.dependencies[0] !== "base") {
			json.dependencies = this.dependencies;
		}
		if (this.filename) { json.filename = this.filename; }
		if (this.size) { json.size = this.size; }
		if (this.hash) { json.hash = this.hash; }
		if (this.isDeleted) { json.is_deleted = this.isDeleted; }
		return json;
	}

	static async fromModFile(modPath) {
		let modInfo;
		{
			// XXX: JSZip needs the whole archive loaded in memory to work.
			// This is clearly untenable and will be replaced later.
			let zip = await JSZip.loadAsync(await fs.readFile(modPath));
			let root = zip.folder(findRoot(zip));

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

		let hash = `sha1:${await libHash.hashFile(modPath)}`;
		return new this({
			...modInfo,

			filename: path.basename(modPath),
			size: (await fs.stat(modPath)).size,
			hash,
			is_deleted: false,
		});
	}
}

module.exports = ModInfo;
