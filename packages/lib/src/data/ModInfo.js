"use strict";
const fs = require("fs-extra");
const JSZip = require("jszip");
const path = require("path");

const libHash = require("../hash");
const libSchema = require("../schema");
const { findRoot } = require("../zip_ops");

const { integerModVersion, integerFactorioVersion, modVersionRegExp } = require("./version");


/**
 * Info about a mod available on the controller.
 *
 * See https://wiki.factorio.com/Tutorial:Mod_structure#info.json for
 * details of the invidiual fields sourced from info.json.
 * @alias module:lib.ModInfo
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
		return integerModVersion(this.version);
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
		return integerFactorioVersion(this.factorioVersion);
	}

	/**
	 * Dependiences for this mod.
	 * Sourced from info.json.
	 * @type {Array<string>}
	 */
	dependencies = ["base"];

	/**
	 * Expected name of zip file containing this mod.
	 * @type {number}
	 */
	get filename() {
		return `${this.name}_${this.version}.zip`;
	}

	/**
	 * Size of the mod in bytes
	 * @type {number}
	 */
	size = 0;

	/**
	 * SHA1 hash of this mod
	 * @type {string=}
	 */
	sha1;

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
			"size": { type: "integer" },
			"sha1": { type: "string" },
			"is_deleted": { type: "boolean" },
		},
	};

	static validate = libSchema.compile(this.jsonSchema);

	static fromJSON(json) {
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
		if (json.sha1) { modInfo.sha1 = json.sha1; }
		if (json.is_deleted) { modInfo.isDeleted = json.is_deleted; }

		return modInfo;
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
		if (this.size) { json.size = this.size; }
		if (this.sha1) { json.sha1 = this.sha1; }
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

		if (!modVersionRegExp.test(modInfo.version)) {
			throw new Error(`Mod's version (${modInfo.version}) is invalid`);
		}

		return this.fromJSON({
			...modInfo,

			size: (await fs.stat(modPath)).size,
			sha1: await libHash.hashFile(modPath),
			is_deleted: false,
		});
	}
}

module.exports = ModInfo;
