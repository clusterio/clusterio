const formatSecond = new Intl.NumberFormat(undefined, { style: "unit", unit: "second", unitDisplay: "narrow" }).format;
const formatMinute = new Intl.NumberFormat(undefined, { style: "unit", unit: "minute", unitDisplay: "narrow" }).format;
const formatHour = new Intl.NumberFormat(undefined, { style: "unit", unit: "hour", unitDisplay: "narrow" }).format;
const formatDay = new Intl.NumberFormat(undefined, { style: "unit", unit: "day", unitDisplay: "narrow" }).format;

/**
 * Formats a duration of time in milliseconds to something human readable.
 * @param ms - Duration to formatDuration
 * @returns human readable representation of the duration.
 */
export function formatDuration(ms: number): string {
	let result = "";
	if (ms < 0) {
		result += "-";
		ms = -ms;
	}

	if (ms > 86400e3) {
		result += formatDay(Math.floor(ms / 86400e3));
		ms %= 86400e3;
	}
	if (ms > 3600e3) {
		result += formatHour(Math.floor(ms / 3600e3));
		ms %= 3600e3;
	}
	if (ms > 60e3) {
		result += formatMinute(Math.floor(ms / 60e3));
		ms %= 60e3;
	}
	result += formatSecond(Math.floor(ms / 1e3));
	return result;
}

export function formatTimestamp(timestampMs: number): string {
	const options = {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
	} as const;
	return new Intl.DateTimeFormat(undefined, options).format(new Date(timestampMs));
}
