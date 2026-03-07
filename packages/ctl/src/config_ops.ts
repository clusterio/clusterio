import * as lib from "@clusterio/lib";

export async function getEditor(argsEditor: string) {
	// eslint-disable-next-line
	return argsEditor || process.env.EDITOR || process.env.VISUAL || undefined
	// needed for the process.env statements to not be flagged by eslint
	// priority for editors is CLI argument > env.EDITOR > env.VISUAL
}

export async function configToKeyVal(data: string) {
	let final: Record<string, string> = {};
	let splitData = data.split(/\r?\n/);
	// split on newlines
	let filtered = splitData.filter((value) => value[0] !== "#").filter((a) => a);
	// the last filter removes empty elements left by the first. Not done on one line due to readability.
	for (let index in filtered) {
		if (index in filtered) {
			let split = filtered[index].split("=");
			let finalIndex = filtered[index][0].trim();
			// split on the = we added earlier, giving us both value and key
			let part = "";
			try {
				part = split[1].trim();
				// it's a string if we can read it
			} catch (err) {
				// if we can't read it, it's a empty field and therefor null
				part = "";
			}
			final[finalIndex] = part;
		}
	}
	return final;
}

export function serializedConfigToString(
	serializedConfig: lib.ConfigSchema,
	configGroup: typeof lib.ControllerConfig | typeof lib.HostConfig | typeof lib.InstanceConfig,
	disallowedList: Record<string, unknown>,
) {
	let allConfigElements = "";
	for (let [name, value] of Object.entries(serializedConfig)) {
		if (name in disallowedList) {
			continue;
		}
		let desc = "";
		try {
			desc += (configGroup.fieldDefinitions as any)[name]!.description;
		} catch (err) {
			desc += "No description found";
		}
		// split onto two lines for readability and es-lint
		if (String(value) === "null") {
			value = "";
		}
		allConfigElements += `${name} = ${value}\n\n`;
	}
	return allConfigElements;
}
