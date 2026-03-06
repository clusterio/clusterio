import { FactorioColor } from "./lua_tools";

/**
 * A localised string.
 * @see [LocalisedString](https://lua-api.factorio.com/stable/types/LocalisedString.html)
 */
export type FactorioLocalisedString = string | [string, ...FactorioLocalisedString[]];

/**
 * Shared properties of all prototypes.
 * @see [PrototypeBase](https://lua-api.factorio.com/stable/types/PrototypeBase.html)
 */
export interface FactorioPrototypeBase {
	[index: string]: unknown,
	type: string,
	name: string,
	order?: string,
	localised_name?: FactorioLocalisedString,
	localised_description?: FactorioLocalisedString,
	factoriopedia_description?: FactorioLocalisedString,
	subgroup?: string,
	hidden?: boolean,
	hidden_in_factoriopedia?: boolean,
	parameter?: boolean,
	factoriopedia_simulation?: unknown,
}

/**
 * Stage the mod setting is part of.
 * @see [settings_type property](https://wiki.factorio.com/Tutorial:Mod_settings#The_setting_type_property)
 */
export type FactorioModSettingType = "startup" | "runtime-global" | "runtime-per-user";

/**
 * Boolean mod setting prototype.
 * @see [bool-setting](https://wiki.factorio.com/Tutorial:Mod_settings#bool-setting)
 */
export interface FactorioBoolSettingPrototype extends FactorioPrototypeBase{
	type: "bool-setting",
	setting_type?: FactorioModSettingType,
	default_value: boolean,
	forced_value?: boolean,
}

/**
 * Integer mod setting prototype.
 * @see [int-setting](https://wiki.factorio.com/Tutorial:Mod_settings#int-setting)
 */
export interface FactorioIntSettingPrototype extends FactorioPrototypeBase{
	type: "int-setting",
	setting_type?: FactorioModSettingType,
	default_value: number,
	minimum_value?: number,
	maximum_value?: number,
	allowed_values?: number[],
}

/**
 * Real number mod setting prototype.
 * @see [double-setting](https://wiki.factorio.com/Tutorial:Mod_settings#double-setting)
 */
export interface FactorioDoubleSettingPrototype extends FactorioPrototypeBase{
	type: "double-setting",
	setting_type?: FactorioModSettingType,
	default_value: number,
	minimum_value?: number,
	maximum_value?: number,
	allowed_values?: number[],
}

/**
 * String mod setting prototype.
 * @see [string-setting](https://wiki.factorio.com/Tutorial:Mod_settings#string-setting)
 */
export interface FactorioStringSettingPrototype extends FactorioPrototypeBase{
	type: "string-setting",
	setting_type?: FactorioModSettingType,
	default_value: string,
	allow_black?: boolean,
	auto_trim?: string,
	allowed_values?: string[],
}

/**
 * Color mod setting prototype.
 * @see [color-setting](https://wiki.factorio.com/Tutorial:Mod_settings#color-setting)
 */
export interface FactorioColorSettingPrototype extends FactorioPrototypeBase{
	type: "color-setting",
	setting_type?: FactorioModSettingType,
	default_value: FactorioColor,
	forced_value?: boolean,
}

export type FactorioModSettingPrototype =
	| FactorioBoolSettingPrototype
	| FactorioIntSettingPrototype
	| FactorioDoubleSettingPrototype
	| FactorioStringSettingPrototype
	| FactorioColorSettingPrototype
;

/**
 * A list of prototypes as it appears in Factorio's Lua API.
 * @see [Data.raw](https://lua-api.factorio.com/stable/types/Data.html#raw)
 */
export type FactorioPrototypes<Prototype = FactorioPrototypeBase> = Record<string, Record<string, Prototype>>

export type ExportSettings = FactorioPrototypes<FactorioModSettingPrototype>;
export type ExportPrototypes = FactorioPrototypes;
export type ExportLocale = [string, string][];
export interface ExportMetadataEntry {
	x: number,
	y: number,
	size: number,
	localised_name?: FactorioLocalisedString,
	category: string,
	path?: string,
}
export type ExportMetadata = [string, ExportMetadataEntry][];
