"use strict";
const zlib = require("zlib");

const libSchema = require("../schema");

const { integerFactorioVersion } = require("./version");


/**
 * A setting for a mod.
 * @typedef {object} module:lib/data/ModPack~ModSetting
 * @property {boolean|number|string} value - Value of the given mod setting.
 */
const ModSettingJsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["value"],
	properties: {
		"value": { type: ["boolean", "number", "string"] },
	},
};

const ModSettingsJsonSchema = {
	type: "object",
	additionalProperties: ModSettingJsonSchema,
};

/**
 * A mod in a mod pack
 * @typedef {object} module:lib/data/ModPack~ModRecord
 * @property {string} name - name of the mod.
 * @property {string} version - version of the mod.
 * @property {string} sha1 - SHA1 hash of the zip file.
 */
const ModRecordJsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["name", "version"],
	properties: {
		"name": { type: "string" },
		"version": { type: "string" },
		"sha1": { type: "string" },
	},
};

/**
 * Factorio Mod Pack
 *
 * Tracks mods and settings for a collection of Factorio mods.
 * @alias module:lib/data/ModPack
 */
class ModPack {
	/**
	 * Id of this mod pack
	 * @type {number}
	 */
	id;

	/**
	 * Name of this mod pack.
	 * @type {string}
	 */
	name = "";

	/**
	 * Description for this modpcak.
	 * @type {string}
	 */
	description = "";

	/**
	 * Version of Factorio this mod pack is for
	 * @type {string}
	 */
	factorioVersion = "1.1.0";

	/**
	 * Integer representation of the factorioVersion
	 * @type {number}
	 */
	get integerFactorioVersion() {
		return integerFactorioVersion(this.factorioVersion);
	}

	/**
	 * Mods included in this mod pack
	 * @type {Map<string, module:lib/data/ModPack~ModRecord>}
	 */
	mods = new Map();

	/**
	 * Mod settings for this mod pack
	 * @type {Object<string, Map<string, module:lib/data/ModPack~ModSetting>>=}
	 */
	settings = {
		"startup": new Map(),
		"runtime-global": new Map(),
		"runtime-per-user": new Map(),
	};

	/**
	 * True if this mod pack has been deleted from the list of mod packs.
	 * @type {boolean}
	 */
	isDeleted = false;

	static jsonSchema = {
		type: "object",
		additionalProperties: false,
		properties: {
			"id": { type: "integer" },
			"name": { type: "string" },
			"description": { type: "string" },
			"factorio_version": { type: "string" },
			"mods": {
				type: "array",
				items: ModRecordJsonSchema,
			},
			"settings": {
				type: "object",
				additionalProperties: false,
				required: ["startup", "runtime-global", "runtime-per-user"],
				properties: {
					"startup": ModSettingsJsonSchema,
					"runtime-global": ModSettingsJsonSchema,
					"runtime-per-user": ModSettingsJsonSchema,
				},
			},
			"is_deleted": { type: "boolean" },
		},
	};

	static validate = libSchema.compile(this.jsonSchema);

	constructor(json = {}) {
		if (json.id) {
			this.id = json.id;
		} else {
			this.id = Math.random() * 2**31 | 0;
		}
		if (json.name) { this.name = json.name; }
		if (json.description) { this.description = json.description; }
		if (json.factorio_version) { this.factorioVersion = json.factorio_version; }
		if (json.mods) { this.mods = new Map(json.mods.map(m => [m.name, m])); }
		if (json.settings) {
			this.settings = {
				"startup": new Map(Object.entries(json.settings["startup"])),
				"runtime-global": new Map(Object.entries(json.settings["runtime-global"])),
				"runtime-per-user": new Map(Object.entries(json.settings["runtime-per-user"])),
			};
		}
		if (json.is_deleted) { this.isDeleted = json.is_deleted; }
	}

	toJSON() {
		let json = {
			id: this.id,
		};
		if (this.name) { json.name = this.name; }
		if (this.description) { json.description = this.description; }
		json.factorio_version = this.factorioVersion;
		if (this.mods.size) { json.mods = [...this.mods.values()]; }
		if (this.settings) {
			json.settings = {
				"startup": Object.fromEntries(this.settings["startup"]),
				"runtime-global": Object.fromEntries(this.settings["runtime-global"]),
				"runtime-per-user": Object.fromEntries(this.settings["runtime-per-user"]),
			};
		}
		if (this.isDeleted) { json.is_deleted = this.isDeleted; }
		return json;
	}

	toModPackString() {
		const json = this.toJSON();
		delete json.id;

		// eslint-disable-next-line node/no-sync
		let buf = zlib.deflateSync(JSON.stringify(json));
		return buf.toString("base64");
	}

	static fromModPackString(modPackString) {
		let buf = Buffer.from(modPackString, "base64");
		try {
			// eslint-disable-next-line node/no-sync
			buf = zlib.inflateSync(buf);
		} catch (err) {
			if (err.code.startsWith("Z_")) {
				throw new Error("Malformed mod pack string: zlib inflate failed");
			}
		}

		let json;
		try {
			json = JSON.parse(buf);
		} catch (err) {
			throw new Error(`Malformed mod pack string: ${err.message}`);
		}

		if (!this.validate(json)) {
			throw new Error("Malformed mod pack string: Schema validation failed");
		}

		return new this(json);
	}
}

module.exports = ModPack;
