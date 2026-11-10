import type { FactorioLocalisedString } from "@clusterio/lib";

type Locale = Map<string, string>;

const maxDepth = 20;
const prototypeReferences: Record<string, string> = {
	ENTITY: "entity-name",
	ITEM: "item-name",
	TILE: "tile-name",
	FLUID: "fluid-name",
};

function substitute(locale: Locale, template: string, parameters: string[]) {
	return template.replace(/__([A-Z_]+)__([^_\s][^\s]*?)__|__(\d+)__/g, (match, kind, name, index) => {
		if (index !== undefined) {
			return parameters[Number(index) - 1] ?? match;
		}
		const category = prototypeReferences[kind];
		return category ? locale.get(`${category}.${name}`) ?? name : match;
	});
}

function resolve(locale: Locale, value: unknown, depth: number): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (!Array.isArray(value) || typeof value[0] !== "string" || depth > maxDepth) {
		return undefined;
	}
	const [key, ...rest] = value;
	if (key === "?") {
		for (const alternative of rest) {
			const result = resolve(locale, alternative, depth + 1);
			if (result !== undefined) {
				return result;
			}
		}
		return undefined;
	}
	const parameters: string[] = [];
	for (const parameter of rest) {
		const result = resolve(locale, parameter, depth + 1);
		if (result === undefined) {
			return undefined;
		}
		parameters.push(result);
	}
	if (key === "") {
		return parameters.join("");
	}
	const template = locale.get(key);
	return template === undefined ? undefined : substitute(locale, template, parameters);
}

/**
 * Resolve a Factorio LocalisedString against exported locale.
 *
 * @param locale - Flattened locale from the mod pack export.
 * @param value - Localised string to resolve.
 * @returns the resolved text, or undefined if a key used is missing from the locale.
 * @see https://lua-api.factorio.com/stable/types/LocalisedString.html
 */
export function resolveLocalisedString(locale: Locale, value: FactorioLocalisedString) {
	return resolve(locale, value, 0);
}

const iconTags: Record<string, string> = {
	"item": "item-name",
	"entity": "entity-name",
	"fluid": "fluid-name",
	"tile": "tile-name",
	"recipe": "recipe-name",
	"technology": "technology-name",
	"item-group": "item-group-name",
	"virtual-signal": "virtual-signal-name",
	"space-location": "space-location-name",
	"planet": "space-location-name",
	"quality": "quality-name",
};
const otherTags = [
	"color", "font", "img", "achievement", "gps", "special-item", "armor", "train", "train-stop", "tooltip",
	"shortcut", "tip",
];
const richTextPattern = new RegExp(
	`\\[(?:/(?:color|font|tooltip)|(${[...Object.keys(iconTags), ...otherTags].join("|")})(?:=([^\\]]*))?)\\]`,
	"g",
);

/**
 * Remove Factorio rich text tags from text, replacing icons of prototypes with their name.
 *
 * @param locale - Flattened locale from the mod pack export.
 * @param text - Text that may contain rich text tags.
 * @returns plain text
 * @see https://wiki.factorio.com/Rich_text
 */
export function stripRichText(locale: Locale, text: string) {
	return text.replace(richTextPattern, (_match, tag: string | undefined, value: string | undefined) => {
		const category = tag ? iconTags[tag] : undefined;
		if (!category || !value) {
			return "";
		}
		const name = value.split(",")[0];
		return locale.get(`${category}.${name}`) ?? name;
	}).trim();
}

function localisedText(locale: Locale, localised: FactorioLocalisedString | undefined, key: string) {
	let text: string | undefined;
	if (localised !== undefined) {
		text = resolveLocalisedString(locale, localised);
	}
	text ??= resolveLocalisedString(locale, [key]);
	return text === undefined ? undefined : stripRichText(locale, text);
}

type SettingPrototype = {
	name: string,
	localised_name?: FactorioLocalisedString,
	localised_description?: FactorioLocalisedString,
};

/**
 * Display name of a mod setting, falling back the same way Factorio does.
 *
 * @param locale - Flattened locale from the mod pack export.
 * @param prototype - Mod setting prototype.
 * @returns localised name, or the internal name if there is none.
 */
export function modSettingName(locale: Locale, prototype: SettingPrototype) {
	return localisedText(locale, prototype.localised_name, `mod-setting-name.${prototype.name}`) || prototype.name;
}

/**
 * Description of a mod setting, falling back the same way Factorio does.
 *
 * @param locale - Flattened locale from the mod pack export.
 * @param prototype - Mod setting prototype.
 * @returns localised description, or undefined if there is none.
 */
export function modSettingDescription(locale: Locale, prototype: SettingPrototype) {
	return localisedText(
		locale, prototype.localised_description, `mod-setting-description.${prototype.name}`
	) || undefined;
}

/**
 * Display name of an allowed value of a string mod setting.
 *
 * @param locale - Flattened locale from the mod pack export.
 * @param name - Internal name of the mod setting.
 * @param value - Allowed value.
 * @returns localised value, or the value itself if there is none.
 */
export function modSettingValueName(locale: Locale, name: string, value: string | number) {
	return localisedText(locale, undefined, `string-mod-setting.${name}-${value}`) || String(value);
}
