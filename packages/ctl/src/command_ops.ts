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
