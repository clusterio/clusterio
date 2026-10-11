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
			// split on the first = only, values may contain = themselves
			let split = filtered[index].indexOf("=");
			if (split === -1) {
				// no value given, it's a empty field and therefor null
				final[filtered[index].trim()] = "";
				continue;
			}
			final[filtered[index].slice(0, split).trim()] = filtered[index].slice(split + 1).trim();
		}
	}
	return final;
}

export function serializedConfigToString(
	serializedConfig: lib.ConfigSchema,
	configClass: typeof lib.ControllerConfig | typeof lib.HostConfig | typeof lib.InstanceConfig,
) {
	const config = configClass.fromJSON({}, "control");
	let allConfigElements = "";
	for (let [name, value] of Object.entries(serializedConfig)) {
		const def = (configClass.fieldDefinitions as lib.ConfigDefs<any>)[name];
		try {
			if (!config.canAccess(name, lib.ConfigAccess.readWrite) || def.hidden) {
				continue;
			}
		} catch (err) {
			// Field does not exist in the config class
			continue;
		}
		if (value === null) {
			value = "";
		} else if (typeof value === "object") {
			value = JSON.stringify(value);
		}
		allConfigElements += `# ${def.description ?? "No description found"}\n${name} = ${value}\n\n`;
	}
	return allConfigElements;
}
