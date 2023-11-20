/**
 * Factorio Compatible INI parser
 *
 * @module lib/ini
 * @author Hornwitser
 */

/**
 * Parse INI file into object of sections
 * @param input - content of INI file to parse.
 * @returns sections parsed from the ini file.
 */
export function parse(input: string) {
	// Ignore BOM at the start of the file
	if (input[0] === "\uFEFF") {
		input = input.slice(1);
	}

	const sections: Record<string, string | Record<string, string>> = {};
	let currentSection: Record<string, string> = sections as Record<string, string>;
	const lines = input.split(/\r\n|\n/);
	for (let number = 1; number <= lines.length; number++) {
		let line = lines[number - 1].replace(/^[\t ]+/, "");
		if (!line || line[0] === "#" || line[0] === ";") {
			continue;
		}

		// Read section header
		if (line[0] === "[") {
			line = line.replace(/[\t ]+$/, "");
			if (line.slice(-1) !== "]") {
				throw new Error(`Unterminated section header on line ${number}`);
			}
			const name = line.slice(1, -1);
			if (Object.prototype.hasOwnProperty.call(sections, name)) {
				throw new Error(`Duplicated section [${name}] on line ${number}`);
			}
			currentSection = {};
			sections[name] = currentSection;
			continue;
		}

		// Read key value
		const equalIndex = line.indexOf("=");
		if (equalIndex === -1) {
			throw new Error(`Missing value for key ${line} on line ${number}`);
		}
		const key = line.slice(0, equalIndex);
		if (Object.prototype.hasOwnProperty.call(currentSection, key)) {
			throw new Error(`Duplicated key ${key} on line ${number}`);
		}
		const value = line.slice(equalIndex + 1);
		currentSection[key] = value;
	}

	return sections;
}

/**
 * Serialize an object of section definitions into an INI file
 * @param sections -
 *     Sections to encode into ini format
 * @returns sections serialized into INI format
 */
export function stringify(sections: Record<string, string | Record<string, string>>) {
	let serialized = [];
	let first = true;

	for (let [key, value] of Object.entries(sections)) {
		if (typeof value === "string") {
			serialized.push(`${key}=${value}`);
			first = false;
		}
	}

	for (let [section, content] of Object.entries(sections)) {
		if (typeof content === "object") {
			if (!first) {
				serialized.push("");
			}
			first = false;
			serialized.push(`[${section}]`);
			for (let [key, value] of Object.entries(content)) {
				serialized.push(`${key}=${value}`);
			}
		}
	}

	if (serialized.length) { serialized.push(""); }
	return serialized.join("\n");
}
