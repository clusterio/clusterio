import type * as lib from "@clusterio/lib";

export type ModSettingScope = "startup" | "runtime-global" | "runtime-per-user";

export type ModSettingField = {
	name: string;
	type: string;
	mod?: string;
	order?: string;
	allowed_values?: unknown;
	localised_name?: lib.FactorioLocalisedString;
	localised_description?: lib.FactorioLocalisedString;
};

const settingTypes = ["bool-setting", "int-setting", "double-setting", "string-setting", "color-setting"];
const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

function typeFromValue(value: lib.ModSetting["value"]) {
	if (typeof value === "boolean") {
		return "bool-setting";
	} else if (typeof value === "number") {
		return "double-setting";
	} else if (typeof value === "string") {
		return "string-setting";
	} else if (typeof value === "object" && "r" in value) {
		return "color-setting";
	}
	throw Error(`Unhandled setting type ${typeof value}`);
}

/**
 * Split the settings of a scope into ones defined by the exported prototypes and stored ones
 * no prototype defines. Without export data there is nothing to compare to, so none are unknown.
 */
export function modSettingFields(
	prototypes: lib.ExportSettings | undefined,
	scope: ModSettingScope,
	stored: Map<string, lib.ModSetting>,
) {
	const fromStored = (name: string): ModSettingField => ({ name, type: typeFromValue(stored.get(name)!.value) });
	if (!prototypes) {
		return { known: [...stored.keys()].map(fromStored), unknown: [] };
	}

	const known: ModSettingField[] = Object.entries(prototypes)
		.filter(([type]) => settingTypes.includes(type))
		.flatMap(([_, settings]) => Object.values(settings))
		.filter(p => p.setting_type === scope)
		.map(p => ({
			name: p.name,
			type: p.type,
			mod: p.mod as string,
			order: p.order,
			allowed_values: p.allowed_values,
			localised_name: p.localised_name,
			localised_description: p.localised_description,
		}))
		.sort((a, b) => strcmp(a.mod, b.mod) || strcmp(a.order || "", b.order || "") || strcmp(a.name, b.name))
	;
	const knownNames = new Set(known.map(field => field.name));
	const unknown = [...stored.keys()]
		.filter(name => !knownNames.has(name))
		.sort(strcmp)
		.map(fromStored)
	;
	return { known, unknown };
}
