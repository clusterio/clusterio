import zlib from "zlib";
import { Type, Static } from "@sinclair/typebox";

import * as libSchema from "../schema";
import * as libLuaTools from "../lua_tools";

import ExportManifest from "./ExportManifest";
import type { Logger } from "../logging";

import ModInfo, { ModDependencyUnsatisfiedReason } from "./ModInfo";

import {
	PartialVersion, PartialVersionSchema, integerPartialVersion,
	FullVersion, FullVersionSchema, normaliseFullVersion,
} from "./version";


export const ModSettingColor = Type.Object({
	r: Type.Number(),
	g: Type.Number(),
	b: Type.Number(),
	a: Type.Number(),
});
export type ModSettingColor = Static<typeof ModSettingColor>;

/**
 * A setting for a mod.
 */
export interface ModSetting {
	/** Value of the given mod setting. */
	value: boolean | number | string | ModSettingColor;
}

const ModSettingJsonSchema = Type.Object({
	"value": Type.Union([Type.Boolean(), Type.Number(), Type.String(), ModSettingColor]),
});

const ModSettingsJsonSchema = Type.Record(Type.String(), ModSettingJsonSchema);

/**
 * A mod in a mod pack
 */
export interface ModRecord {
	/** name of the mod. */
	name: string,
	/** if mod is to be loaded. */
	enabled: boolean,
	/** version of the mod. */
	version: FullVersion,
	/** SHA1 hash of the zip file. */
	sha1?: string,
	/** Used inside packages\web_ui\src\components\ModPackViewPage.tsx to define an error type. */
	error?: "missing" | "bad_checksum",
	/** Used inside packages\web_ui\src\components\ModPackViewPage.tsx to define an warning type. */
	warning?: ModDependencyUnsatisfiedReason | "wrong_factorio_version",
	/** Used inside packages\web_ui\src\components\ModPackViewPage.tsx when there is no error. */
	info?: ModInfo,
}

const ModRecordJsonSchema = Type.Object({
	"name": Type.String(),
	"enabled": Type.Boolean(),
	"version": FullVersionSchema,
	"sha1": Type.Optional(Type.String()),
});

type PropertyType = null | boolean | number | string | PropertyType[] | { [key: string]: PropertyType };

/**
 * Factorio Mod Pack
 *
 * Tracks mods and settings for a collection of Factorio mods.
 */
export default class ModPack {
	declare ["constructor"]: typeof ModPack;

	/**
	 * Id of this mod pack
	 */
	id: number = Math.random() * 2**31 | 0;

	/**
	 * Name of this mod pack.
	 */
	name = "";

	/**
	 * Description for this modpcak.
	 */
	description = "";

	/**
	 * Version of Factorio this mod pack is for
	 */
	factorioVersion = "1.1.0" as PartialVersion;

	/**
	 * Integer representation of the factorioVersion
	 */
	get integerFactorioVersion() {
		return integerPartialVersion(this.factorioVersion);
	}

	/**
	 * Mods included in this mod pack
	 */
	mods = new Map<string, ModRecord>();

	/**
	 * Mod settings for this mod pack
	 */
	settings = {
		"startup": new Map<string, ModSetting>(),
		"runtime-global": new Map<string, ModSetting>(),
		"runtime-per-user": new Map<string, ModSetting>(),
	};

	/**
	 * Mapping to files containing exported data for this modpack
	 */
	exportManifest?: ExportManifest;

	/** Millisecond Unix timestamp this entry was last updated at */
	updatedAtMs = 0;

	/**
	 * True if this mod pack has been deleted from the list of mod packs.
	 */
	isDeleted = false;

	shallowClone() {
		const clone = new this.constructor();
		clone.id = this.id;
		clone.name = this.name;
		clone.description = this.description;
		clone.factorioVersion = this.factorioVersion;
		clone.mods = this.mods;
		clone.settings = this.settings;
		clone.exportManifest = this.exportManifest;
		clone.updatedAtMs = this.updatedAtMs;
		clone.isDeleted = this.isDeleted;
		return clone;
	}

	static jsonSchema = Type.Object({
		"id": Type.Optional(Type.Integer()),
		"name": Type.String(),
		"description": Type.String(),
		"factorio_version": PartialVersionSchema,
		"mods": Type.Array(ModRecordJsonSchema),
		"settings": Type.Object({
			"startup": ModSettingsJsonSchema,
			"runtime-global": ModSettingsJsonSchema,
			"runtime-per-user": ModSettingsJsonSchema,
		}),
		"export_manifest": Type.Optional(ExportManifest.jsonSchema),
		"updated_at_ms": Type.Optional(Type.Number()),
		"is_deleted": Type.Optional(Type.Boolean()),
	});

	static validate = libSchema.compile<Static<typeof ModPack.jsonSchema>>(this.jsonSchema as any);

	static fromJSON(json: Static<typeof ModPack.jsonSchema>) {
		const modPack = new this();

		if (json.id) {
			modPack.id = json.id;
		} else {
			modPack.id = Math.random() * 2**31 | 0;
		}
		if (json.name) { modPack.name = json.name; }
		if (json.description) { modPack.description = json.description; }
		if (json.factorio_version) { modPack.factorioVersion = json.factorio_version; }
		if (json.mods) { modPack.mods = new Map(json.mods.map((m: ModRecord) => [m.name, m])); }
		if (json.settings) {
			modPack.settings = {
				"startup": new Map(Object.entries(json.settings["startup"])),
				"runtime-global": new Map(Object.entries(json.settings["runtime-global"])),
				"runtime-per-user": new Map(Object.entries(json.settings["runtime-per-user"])),
			};
		}
		if (json.export_manifest) { modPack.exportManifest = ExportManifest.fromJSON(json.export_manifest); }
		if (json.updated_at_ms) { modPack.updatedAtMs = json.updated_at_ms; }
		if (json.is_deleted) { modPack.isDeleted = json.is_deleted; }

		const builtinMods = ModPack.getBuiltinMods(modPack.factorioVersion);
		for (const builtinMod of builtinMods) {
			if (!modPack.mods.has(builtinMod.name)) {
				modPack.mods.set(builtinMod.name, builtinMod);
			}
		}

		return modPack;
	}

	toJSON() {
		let json: Static<typeof ModPack.jsonSchema> = {
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
		if (this.exportManifest) { json.export_manifest = this.exportManifest; }
		if (this.updatedAtMs) { json.updated_at_ms = this.updatedAtMs; }
		if (this.isDeleted) { json.is_deleted = this.isDeleted; }
		return json;
	}

	toModPackString() {
		const json = this.toJSON();
		delete json.id;
		delete json.export_manifest;
		delete json.updated_at_ms;
		delete json.is_deleted;

		// eslint-disable-next-line node/no-sync
		let buf = zlib.deflateSync(JSON.stringify(json));
		return buf.toString("base64");
	}

	static fromModPackString(modPackString: string) {
		let buf = Buffer.from(modPackString, "base64");
		try {
			// eslint-disable-next-line node/no-sync
			buf = Buffer.from(zlib.inflateSync(buf));
		} catch (err: any) {
			if (err.code.startsWith("Z_")) {
				throw new Error("Malformed mod pack string: zlib inflate failed");
			}
		}

		let json: unknown;
		try {
			json = JSON.parse(buf.toString());
		} catch (err: any) {
			throw new Error(`Malformed mod pack string: ${err.message}`);
		}

		if (!this.validate(json)) {
			throw new Error("Malformed mod pack string: Schema validation failed");
		}

		return this.fromJSON(json);
	}

	toModSettingsDat() {
		function uint8Byte(int: number) {
			return Buffer.from(Uint8Array.from([int]).buffer);
		}
		function int16Bytes(int: number) {
			return Buffer.from(Int16Array.from([int]).buffer);
		}
		function uint32Bytes(int: number) {
			return Buffer.from(Uint32Array.from([int]).buffer);
		}
		function uint32SpaceOptimizedBytes(int: number) {
			if (0 <= int && int < 0xff) {
				return uint8Byte(int);
			}
			return Buffer.concat([
				uint8Byte(0xff),
				uint32Bytes(int),
			]);
		}
		function doubleBytes(double: number) {
			return Buffer.from(Float64Array.from([double]).buffer);
		}
		function stringBytes(str: string) {
			const buf = Buffer.from(str, "utf8");
			return Buffer.concat([
				uint32SpaceOptimizedBytes(buf.length),
				buf,
			]);
		}
		function immutableStringBytes(str?: string) {
			if (str === undefined) {
				return uint8Byte(1); // empty
			}
			return Buffer.concat([
				uint8Byte(0), // empty
				stringBytes(str),
			]);
		}
		function versionBytes(version: string) {
			const [main, major, minor] = version.split(".").map(n => Number.parseInt(n, 10));
			return Buffer.concat([
				int16Bytes(main),
				int16Bytes(major),
				int16Bytes(minor),
				Buffer.alloc(2), // developer
				Buffer.alloc(1), // reserved byte
			]);
		}
		function propertyTreeListBytes(entries: [string | undefined, PropertyType][]) {
			const sizeBytes = uint32Bytes(entries.length);
			const itemBytes = entries.flatMap(([key, item]) => [
				immutableStringBytes(key),

				propertyTreeBytes(item),
			]);
			return Buffer.concat([
				sizeBytes,
				...itemBytes,
			]);
		}
		function propertyTreeBytes(element: PropertyType) {
			let type: number;
			let dataBytes: Buffer;
			if (element === null) {
				type = 1;
				dataBytes = Buffer.alloc(0);
			} else if (typeof element === "boolean") {
				type = 1;
				dataBytes = uint8Byte(Number(element));
			} else if (typeof element === "number") {
				type = 2;
				dataBytes = doubleBytes(element);
			} else if (typeof element === "string") {
				type = 3;
				dataBytes = immutableStringBytes(element);
			} else if (element instanceof Array) {
				type = 4;
				dataBytes = propertyTreeListBytes(element.map(item => [undefined, item]));
			} else if (typeof element === "object" && element !== null) {
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
	 * Fill in missing and incorrect settings with their default values
	 *
	 * Uses the provided setting prototypes to correct any missing and or
	 * incorrect mod settings in the mod pack with the default value from
	 * the prototype.
	 *
	 * @param settingPrototypes -
	 *     Setting prototypes exported from the game.
	 * @param logger - Logger used to report warnings on.
	 */
	fillDefaultSettings(settingPrototypes: Record<string, object>, logger: Logger) {
		const knownTypes = ["bool-setting", "int-setting", "double-setting", "string-setting", "color-setting"];
		let prototypes = Object.entries(settingPrototypes)
			.filter(([type, _]) => knownTypes.includes(type))
			.flatMap(([_, settings]) => Object.values(settings))
		;

		for (let prototype of prototypes) {
			const settingType = prototype.setting_type as keyof typeof this.settings;
			if (!["startup", "runtime-global", "runtime-per-user"].includes(settingType)) {
				logger.warn(`Ignoring ${prototype.name} with unknown setting_type ${settingType}`);
				continue;
			}
			if (prototype.default_value === undefined) {
				logger.warn(`Ignoring ${prototype.name} with missing default_value`);
				continue;
			}
			let value = this.settings[settingType].get(prototype.name)?.value ?? prototype.default_value;
			const type = prototype.type;
			if (
				type === "bool-setting" && typeof value !== "boolean"
				|| type === "color-setting" && typeof value !== "object"
				|| (type === "int-setting" || type === "double-setting") && typeof value !== "number"
			) {
				value = prototype.default_value;
			}
			if (type === "string-setting" && typeof value !== "string") {
				value = typeof value === "object" ? prototype.default_value : String(value ?? "");
			}
			if (type === "color-setting") {
				value = libLuaTools.normalizeColor(value as object);
			}
			this.settings[settingType].set(prototype.name, { value });
		}
	}

	/** Array of default mod packs which should exist on a newly installed cluster */
	static defaultModPacks = [
		...(["0.17", "0.18", "1.0", "1.1", "2.0"] as const)
			.map(version => this.fromJSON({
				name: `Base Game ${version}`,
				description: `Factorio ${version} with no extra mods.`,
				factorio_version: version,
			} as any)),
		...(["2.0"] as const)
			.map(version => this.fromJSON({
				name: `Space Age ${version}`,
				description: `Factorio ${version} with Space Age expansion.`,
				factorio_version: version,
				mods: [
					{ name: "elevated-rails", enabled: true, version: normaliseFullVersion(version) },
					{ name: "quality", enabled: true, version: normaliseFullVersion(version) },
					{ name: "space-age", enabled: true, version: normaliseFullVersion(version) },
				],
			} as any)),
	];

	/**
	 * Returns an array of ModRecord containing all mods included in factorio
	 *
	 * @param factorioVersion - Factorio version to get the default mods for
	 * @return Built in mods for the given version
	 */
	static getBuiltinMods(factorioVersion: PartialVersion) {
		factorioVersion = normaliseFullVersion(factorioVersion);
		let defaultMods: ModRecord[] = [
			// "core" not included because core cannot be disabled
			{ name: "base", enabled: true, version: factorioVersion },
		];

		const integerVersion = integerPartialVersion(factorioVersion);
		if (integerVersion >= integerPartialVersion("1.2")) {
			defaultMods = defaultMods.concat([
				{ name: "elevated-rails", enabled: false, version: factorioVersion },
				{ name: "quality", enabled: false, version: factorioVersion },
				{ name: "space-age", enabled: false, version: factorioVersion },
			]);
		}

		return defaultMods;
	}

	static getBuiltinModNames(factorioVersion: PartialVersion) {
		return this.getBuiltinMods(factorioVersion).map(builtinMod => builtinMod.name);
	}
}
