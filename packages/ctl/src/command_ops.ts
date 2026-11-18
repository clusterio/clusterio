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

export const outputFormats = ["human", "json"] as const;
export type OutputFormat = typeof outputFormats[number];

/**
 * Prints the results of a ctl command in the format chosen with --output
 *
 * In json mode each call to result prints one line of JSON to stdout.
 */
export class CommandOutput {
	/** True once a result has been printed */
	written = false;
	/** Command prints a JSON line per item as it runs instead of a single result */
	streaming = false;

	constructor(
		public format: OutputFormat = "human",
	) { }

	get json() {
		return this.format === "json";
	}

	/**
	 * Print the result of a command
	 *
	 * @param data - Printed as JSON in json mode.
	 * @param human - Prints the result in human mode, defaults to printing data as is.
	 */
	result(data: unknown, human: () => void = () => print(data)) {
		this.written = true;
		if (this.json) {
			print(JSON.stringify(toPlain(data)));
		} else {
			human();
		}
	}

	/** Print a list of objects as a table, or as an array in json mode */
	table(rows: object[]) {
		this.result(rows, () => print(asTable(rows)));
	}

	/** Print an error as `{ "error": ClassName, "message": string }` */
	error(err: unknown) {
		this.written = true;
		print(JSON.stringify(errorToJson(err)));
	}

	/** Print `{}` in json mode for commands that finished without printing a result */
	finish() {
		if (this.json && !this.written && !this.streaming) {
			this.result({});
		}
	}
}
