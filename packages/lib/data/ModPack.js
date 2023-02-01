"use strict";
const zlib = require("zlib");

const libSchema = require("../schema");

const ExportManifest = require("./ExportManifest");
const { integerFactorioVersion } = require("./version");


/**
 * A setting for a mod.
 * @typedef {object} module:lib/data.ModPack~ModSetting
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
 * @typedef {object} module:lib/data.ModPack~ModRecord
 * @property {string} name - name of the mod.
 * @property {boolean} enabled - if mod is to be loaded.
 * @property {string} version - version of the mod.
 * @property {string=} sha1 - SHA1 hash of the zip file.
 */
const ModRecordJsonSchema = {
	type: "object",
	required: ["name", "enabled", "version"],
	properties: {
		"name": { type: "string" },
		"enabled": { type: "boolean" },
		"version": { type: "string" },
		"sha1": { type: "string" },
	},
};

/**
 * Factorio Mod Pack
 *
 * Tracks mods and settings for a collection of Factorio mods.
 * @alias module:lib/data.ModPack
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
	 * @type {Map<string, module:lib/data.ModPack~ModRecord>}
	 */
	mods = new Map();

	/**
	 * Mod settings for this mod pack
	 * @type {Object<string, Map<string, module:lib/data.ModPack~ModSetting>>=}
	 */
	settings = {
		"startup": new Map(),
		"runtime-global": new Map(),
		"runtime-per-user": new Map(),
	};

	/**
	 * Mapping to files containing exported data for this modpack
	 * @type {module:lib/data.ExportManifest|undefined}
	 */
	exportManifest;

	/**
	 * True if this mod pack has been deleted from the list of mod packs.
	 * @type {boolean}
	 */
	isDeleted = false;

	static jsonSchema = {
		type: "object",
		additionalProperties: false,
		required: ["name", "description", "factorio_version", "mods", "settings"],
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
			"export_manifest": ExportManifest.jsonSchema,
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
		if (json.export_manifest) { this.exportManifest = new ExportManifest(json.export_manifest); }
		if (json.is_deleted) { this.isDeleted = json.is_deleted; }

		if (!this.mods.has("base")) {
			this.mods.set("base", { name: "base", enabled: true, version: this.factorioVersion });
		}
	}

	toJSON() {
		let json = {
			id: this.id,
			name: this.name,
			description: this.description,
			factorio_version: this.factorioVersion,
			mods: [...this.mods.values()],
			settings: {
				"startup": Object.fromEntries(this.settings["startup"]),
				"runtime-global": Object.fromEntries(this.settings["runtime-global"]),
				"runtime-per-user": Object.fromEntries(this.settings["runtime-per-user"]),
			},
		};
		if (this.exportManifest) { json.export_manifest = this.exportManifest.toJSON(); }
		if (this.isDeleted) { json.is_deleted = this.isDeleted; }
		return json;
	}

	toModPackString() {
		const json = this.toJSON();
		delete json.id;
		delete json.export_manifest;

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

	toModSettingsDat() {
		function uint8Byte(int) {
			return Buffer.from(Uint8Array.from([int]).buffer);
		}
		function int16Bytes(int) {
			return Buffer.from(Int16Array.from([int]).buffer);
		}
		function uint32Bytes(int) {
			return Buffer.from(Uint32Array.from([int]).buffer);
		}
		function uint32SpaceOptimizedBytes(int) {
			if (0 <= int && int < 0xff) {
				return uint8Byte(int);
			}
			return Buffer.concat([
				uint8Byte(0xff),
				uint32Bytes(int),
			]);
		}
		function doubleBytes(double) {
			return Buffer.from(Float64Array.from([double]).buffer);
		}
		function stringBytes(str) {
			const buf = Buffer.from(str, "utf8");
			return Buffer.concat([
				uint32SpaceOptimizedBytes(buf.length),
				buf,
			]);
		}
		function immutableStringBytes(str) {
			if (str === undefined) {
				return uint8Byte(1); // empty
			}
			return Buffer.concat([
				uint8Byte(0), // empty
				stringBytes(str),
			]);
		}
		function versionBytes(version) {
			const [main, major, minor] = version.split(".").map(n => Number.parseInt(n, 10));
			return Buffer.concat([
				int16Bytes(main),
				int16Bytes(major),
				int16Bytes(minor),
				Buffer.alloc(2), // developer
				Buffer.alloc(1), // reserved byte
			]);
		}
		function propertyTreeListBytes(entries) {
			const sizeBytes = uint32Bytes(entries.length);
			const itemBytes = entries.flatMap(([key, item]) => [
				immutableStringBytes(key),
				// eslint-disable-next-line no-use-before-define
				propertyTreeBytes(item),
			]);
			return Buffer.concat([
				sizeBytes,
				...itemBytes,
			]);
		}
		function propertyTreeBytes(element) {
			let type;
			let dataBytes;
			if (typeof element === null) {
				type = 1;
				dataBytes = Buffer.alloc(0);
			} else if (typeof element === "boolean") {
				type = 1;
				dataBytes = uint8Byte(element);
			} else if (typeof element === "number") {
				type = 2;
				dataBytes = doubleBytes(element);
			} else if (typeof element === "string") {
				type = 3;
				dataBytes = immutableStringBytes(element);
			} else if (element instanceof Array) {
				type = 4;
				dataBytes = propertyTreeListBytes(element.map(item => [undefined, item]));
			} else if (typeof element === "object") {
				type = 5;
				dataBytes = propertyTreeListBytes(Object.entries(element));
			} else {
				throw new Error("Bad element passed to propertyTreeBytes");
			}
			return Buffer.concat([
				uint8Byte(type),
				Buffer.alloc(1), // anyTypeFlag
				dataBytes,
			]);
		}

		return Buffer.concat([
			versionBytes(this.factorioVersion),
			propertyTreeBytes(this.toJSON().settings),
		]);
	}

	/**
	 * Fill in missing settings with their default values
	 *
	 * Uses the provided setting prototypes to add any missing mod settings
	 * in the mod pack with the default value from the prototype.
	 *
	 * @param {Object<string, object>} settingPrototypes -
	 *     Setting prototypes exported from the game.
	 * @param {Logger} logger - Logger used to report warnings on.
	 */
	fillDefaultSettings(settingPrototypes, logger) {
		const knownTypes = ["bool-setting", "int-setting", "double-setting", "string-setting"];
		let prototypes = Object.entries(settingPrototypes)
			.filter(([type, _]) => knownTypes.includes(type))
			.flatMap(([_, settings]) => Object.values(settings))
		;

		for (let prototype of prototypes) {
			if (!["startup", "runtime-global", "runtime-per-user"].includes(prototype.setting_type)) {
				logger.warn(`Ignoring ${prototype.name} with unknown setting_type ${prototype.setting_type}`);
				continue;
			}
			if (prototype.default_value === undefined) {
				logger.warn(`Ignoring ${prototype.name} with missing default_value`);
				continue;
			}
			if (this.settings[prototype.setting_type].get(prototype.name)) {
				continue;
			}

			this.settings[prototype.setting_type].set(prototype.name, { value: prototype.default_value });
		}
	}
}

module.exports = ModPack;
