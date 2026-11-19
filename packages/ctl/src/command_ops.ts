import asTableModule from "as-table";

export function print(...content: any) {
	// eslint-disable-next-line no-console
	console.log(...content);
}

function formatCell(value: unknown) {
	if (value instanceof Set) {
		return [...value].join(", ");
	}
	return String(value);
}

export const asTable = asTableModule.configure({ delimiter: " | ", print: formatCell });

/** Copy of object with only the given fields, or all of them if fields includes "all" */
export function pickFields(object: object, fields: string[]) {
	if (fields.includes("all")) {
		return object;
	}
	return Object.fromEntries(Object.entries(object).filter(([field]) => fields.includes(field)));
}

/** Convert class instances, Sets and Maps into plain JSON values, ignoring wire format toJSON methods */
export function toPlain(value: unknown): unknown {
	if (value instanceof Set || value instanceof Array) {
		return [...value].map(toPlain);
	}
	if (value instanceof Map) {
		return Object.fromEntries([...value].map(([key, entry]) => [key, toPlain(entry)]));
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toPlain(entry)]));
	}
	return value;
}

/** Describe an error as `{ error: ClassName, message: string }` */
export function errorToJson(err: unknown) {
	if (err instanceof Error) {
		return { error: err.constructor.name, message: err.message };
	}
	return { error: "Error", message: String(err) };
}

/** JSON.stringify replacer for Sets and Maps that have no toJSON method */
function wireReplacer(key: string, value: unknown) {
	if (value instanceof Set) {
		return [...value];
	}
	if (value instanceof Map) {
		return Object.fromEntries(value);
	}
	return value;
}

export const outputFormats = ["human", "json", "wire"] as const;
export type OutputFormat = typeof outputFormats[number];

/**
 * Prints the results of a ctl command in the format chosen with --output
 *
 * In json and wire mode each call to result prints one line of JSON to stdout. json uses the
 * property names of the objects, wire uses their toJSON methods to give the format sent over the link.
 */
export class CommandOutput {
	/** True once a result has been printed */
	written = false;
	/** Command prints log events as results while it runs and has no final result */
	streamingLog = false;

	constructor(
		public format: OutputFormat = "human",
	) { }

	get human() {
		return this.format === "human";
	}

	/**
	 * Print the result of a command
	 *
	 * @param data - Printed as JSON in json and wire mode.
	 * @param human - Prints the result in human mode, defaults to printing data as is.
	 */
	result(data: unknown, human: () => void = () => print(data)) {
		this.written = true;
		if (this.format === "json") {
			print(JSON.stringify(toPlain(data)));
		} else if (this.format === "wire") {
			print(JSON.stringify(data, wireReplacer));
		} else {
			human();
		}
	}

	/**
	 * Print a list of objects as a table, or as an array in json and wire mode
	 *
	 * @param rows - Printed as is in json and wire mode.
	 * @param map - Converts each row into the table row printed in human mode.
	 */
	table<T extends object>(rows: T[], map: (row: T) => object = row => row) {
		this.result(rows, () => print(asTable(rows.map(map))));
	}

	/**
	 * Print an error as `{ "error": ClassName, "message": string }` in json and wire mode
	 *
	 * @param err - Error to print.
	 * @param human - Reports the error in human mode.
	 */
	error(err: unknown, human: () => void) {
		this.written = true;
		if (this.human) {
			human();
		} else {
			print(JSON.stringify(errorToJson(err)));
		}
	}

	/** Print a success result for commands that finished without printing one */
	finish() {
		if (!this.written && !this.streamingLog) {
			this.result({ success: true }, () => print("Command ran successfully"));
		}
	}
}
