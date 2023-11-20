import winston from "winston";
import Transport from "winston-transport";
import { LEVEL, MESSAGE } from "triple-beam";

export const levels = Object.freeze({
	fatal: 0,
	error: 1,
	warn: 2,
	audit: 3,
	info: 4,
	server: 5,
	verbose: 6,
});

export const colors = {
	fatal: "inverse red",
	error: "bold brightRed",
	warn: "bold brightYellow",
	audit: "bold brightGreen",
	info: "bold brightBlue",
	server: "bold",
	verbose: "bold grey",
} as const;
winston.addColors(colors);

// The Console Transport is replicated here because it's overly complicated
// in winston, writes to stdout/err instead of console and doesn't work in
// the browser.
export class ConsoleTransport extends Transport {
	errorLevels: Set<string>;
	warnLevels: Set<string>;
	filter: (info: object) => boolean;

	constructor(
		options: Transport.TransportStreamOptions & {
			errorLevels?: string[],
			warnLevels?: string[],
			filter?: ConsoleTransport["filter"]
		} = {}
	) {
		super(options);
		this.errorLevels = new Set(options.errorLevels || ["fatal", "error"]);
		this.warnLevels = new Set(options.warnLevels || ["warn"]);
		this.filter = options.filter || (() => true);
	}

	log(info: any, callback: () => void) {
		if (!this.filter(info)) {
			return callback();
		}

		/* eslint-disable no-console */
		if (this.errorLevels.has(info[LEVEL])) {
			console.error(info[MESSAGE]);
		} else if (this.warnLevels.has(info[LEVEL])) {
			console.warn(info[MESSAGE]);
		} else {
			console.log(info[MESSAGE]);
		}
		/* eslint-enable no-console */
		return callback();
	}
}

/**
 * Formats winston log messages for the web console
 */
export class WebConsoleFormat {
	constructor(
		public options = {}
	) { }

	transform(info: any, _options: object) {
		let src = " ";
		if (info.host_id !== undefined) {
			src += `s:${info.host_name} - `;
		}
		if (info.instance_id !== undefined) {
			src += `i:${info.instance_name}`;
		}
		if (info.plugin) {
			src += `${info.plugin}: `;
		}

		if (info.stack) {
			info[MESSAGE] = `[${info.level}]${src}${info.stack}`;
		} else {
			info[MESSAGE] = `[${info.level}]${src}${info.message}`;
		}
		return info;
	}
}

/**
 * Filter object for logs
 */
export interface LogFilter {
	/**
	 * Maximum log level to include. Higher levels are more verbose.
	 */
	maxLevel?: keyof typeof levels;
	/**
	 * Include log entries from controller, all hosts and all instances.
	 */
	all?: boolean;
	/**
	 * Include log entries from the controller.
	 */
	controller?: boolean;
	/**
	 * Include log entries for the given hosts and instances of those
	 * hosts by id.
	 */
	hostIds?: number[];
	/**
	 * Include log entries for the given instances by id.
	 */
	instanceIds?: number[];
}

/**
 * Create log filter by level and source.
 *
 * @param filter -
 *     Filter to filter log entries by.
 * @returns
 *     filter returning true for log entries that match it.
 */
export function logFilter({ all, controller, hostIds, instanceIds, maxLevel }: LogFilter) {
	return (info: any) => {
		// Note: reversed to filter out undefined levels
		if (maxLevel && !((levels as any)[info.level] <= levels[maxLevel])) {
			return false;
		}

		if (all) {
			return true;
		}
		if (controller && info.host_id === undefined) {
			return true;
		}
		if (
			hostIds
			&& info.host_id !== undefined
			&& info.instance_id === undefined
			&& hostIds.includes(info.host_id)
		) {
			return true;
		}
		if (instanceIds && info.instance_id !== undefined && instanceIds.includes(info.instance_id)) {
			return true;
		}
		return false;
	};
}

export const logger = winston.createLogger({
	level: "verbose",
	levels,
	format: winston.format.timestamp(),
}) as unknown as Logger;

// Who in their right mind thought that log levels should be hard coded
// into the type when you can define custom levels you want to support?
export type Logger = Omit<winston.Logger,
	"error" | "warn" | "help" | "data" | "info" | "debug" | "prompt" | "http" | "verbose" | "input" | "silly" |
	"emerg" | "alert" | "crit" | "warning" | "notice" |
	"child"
> & {
	fatal: winston.LeveledLogMethod,
	error: winston.LeveledLogMethod,
	warn: winston.LeveledLogMethod,
	audit: winston.LeveledLogMethod,
	info: winston.LeveledLogMethod,
	server: winston.LeveledLogMethod,
	verbose: winston.LeveledLogMethod,
	child(options: object): Logger,
};
