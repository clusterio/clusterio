/**
 * Utilities for logging on the Node.js side
 *
 * @author Hornwitser
 * @module lib/logging_utils
 */
import fs from "fs-extra";
import path from "path";
import stream from "stream";
import util from "util";
import winston from "winston";
import Transport from "winston-transport";
import { LEVEL, MESSAGE } from "triple-beam";
import chalk from "chalk";

import * as libData from "./data";
import * as libErrors from "./errors";
import * as libFileOps from "./file_ops";
import { type LogFilter, levels, logFilter, logger } from "./logging";
import * as libStream from "./stream";
import type { Link } from "./link";

const finished = util.promisify(stream.finished);

interface SecondsLogOutput {
	/** Where the message came from, one of "stdout" and "stderr". */
	source: "stdout" | "stderr";
	/** Timestamp format, one of "date", "seconds" and "none". */
	format: "seconds";
	/** Timestamp of the message.  Not present if format is "none". */
	time: string;
	/** Type of message, one of "log", "action" and "generic". */
	type: "log";
	/** Log level for "log" type.  i.e "Info" normally. */
	level: string;
	/** File reported for "log" type. */
	file: string;
	/** Main content of the line. */
	message: string;
}
interface SecondsGenericOutput {
	/** Where the message came from, one of "stdout" and "stderr". */
	source: "stdout" | "stderr";
	/** Timestamp format, one of "date", "seconds" and "none". */
	format: "seconds";
	/** Timestamp of the message.  Not present if format is "none". */
	time: string;
	/** Type of message, one of "log", "action" and "generic". */
	type: "generic";
	/** Main content of the line. */
	message: string;
}
interface DateActionOutput {
	/** Where the message came from, one of "stdout" and "stderr". */
	source: "stdout" | "stderr";
	/** Timestamp format, one of "date", "seconds" and "none". */
	format: "date";
	/** Timestamp of the message.  Not present if format is "none". */
	time: string;
	/** Type of message, one of "log", "action" and "generic". */
	type: "action";
	/** Kind of action for "action" type. i.e "CHAT" for chat. */
	action: string;
	/** Main content of the line. */
	message: string;
}
interface DateGenericOutput {
	/** Where the message came from, one of "stdout" and "stderr". */
	source: "stdout" | "stderr";
	/** Timestamp format, one of "date", "seconds" and "none". */
	format: "date";
	/** Timestamp of the message.  Not present if format is "none". */
	time: string;
	/** Type of message, one of "log", "action" and "generic". */
	type: "generic";
	/** Main content of the line. */
	message: string;
}
interface UnformattedOutput {
	/** Where the message came from, one of "stdout" and "stderr". */
	source: "stdout" | "stderr";
	/** Timestamp format, one of "date", "seconds" and "none". */
	format: "none";
	/** Type of message, one of "log", "action" and "generic". */
	type: "generic";
	/** Main content of the line. */
	message: string;
}
export type ParsedFactorioOutput =
	| SecondsLogOutput
	| SecondsGenericOutput
	| DateActionOutput
	| DateGenericOutput
	| UnformattedOutput
;

/**
 * Format a parsed Factorio message with colors
 *
 * Formats a parsed Factorio output from lib/factorio into a readable
 * colorized output using terminal escape codes that can be printed.
 *
 * @param parsed - Parsed Factorio server output.
 * @returns terminal colorized message.
 * @private
 */
function formatServerOutput(parsed: ParsedFactorioOutput) {
	let time = "";
	if (parsed.format === "seconds") {
		time = `${chalk.yellow(parsed.time.padStart(8))} `;
	} else if (parsed.format === "date") {
		time = `${chalk.yellow(parsed.time)} `;
	}

	let info = "";
	if (parsed.type === "log") {
		let level = parsed.level;
		if (level === "Script") {
			level = chalk.bold.greenBright(level);
		} else if (level === "Verbose") {
			level = chalk.bold.gray(level);
		} else if (level === "Info") {
			level = chalk.bold.blueBright(level);
		} else if (parsed.level === "Warning") {
			level = chalk.bold.yellowBright(level);
		} else if (parsed.level === "Error") {
			level = chalk.bold.redBright(level);
		}

		info = `${level} ${chalk.gray(parsed.file)}: `;

	} else if (parsed.type === "action") {
		info = `[${chalk.yellow(parsed.action)}] `;
	}

	return time + info + parsed.message;
}

// These are defined here to avoid circular dependencies and pulling them
// into the web interface code.

/**
 * Formats winston log messages for a character terminal.
 */
export class TerminalFormat {
	colorize: winston.Logform.Colorizer;

	constructor(
		public options: object = {}
	) {
		this.colorize = winston.format.colorize(options);
	}

	transform(info: any, options: { showTimestamp: boolean }) {
		info = this.colorize.transform(info, this.colorize.options);
		let ts = "";
		if (options.showTimestamp && info.timestamp) {
			ts = `${info.timestamp.replace("T", " ")} `;
		}

		let src = " ";
		if (info.instance_name) {
			src += `i:${info.instance_name} `;

		} else if (info.host_name) {
			src += `h:${info.host_name} `;
		}
		if (info.plugin) {
			src += `${info.plugin}: `;
		}

		if (info[LEVEL] === "server" && info.parsed) {
			info.message = formatServerOutput(info.parsed);
		}

		if (info.stack) {
			info[MESSAGE] = `${ts}[${info.level}]${src}${info.stack}`;
		} else {
			info[MESSAGE] = `${ts}[${info.level}]${src}${info.message}`;
		}
		return info;
	}
}

/**
 * Sends logs over a lib/link connection.
 */
export class LinkTransport extends Transport {
	link: Link;
	filter?: (info: any) => boolean;

	constructor(
		options: Transport.TransportStreamOptions & {
			link: Link,
			filter?: (info: any) => boolean,
		}
	) {
		super(options);

		this.link = options.link;
		this.filter = options.filter;
	}

	log(info: any, callback: () => void) {
		if (this.filter && !this.filter(info)) {
			return callback();
		}

		try {
			this.link.send(new libData.LogMessageEvent(info));
		} catch (err) {
			// Ignore session lost errors.
			if (!(err instanceof libErrors.SessionLost)) {
				throw err;
			}
		}
		return callback();
	}
}

const logFileGlob = /^[a-z]+-(\d{4}-\d{2}-\d{2})\.log$/;
const logIndexVersion = 2;

/**
 * Keeps an index over a log directory to speed up queries to it
 */
export class LogIndex {
	index: Map<string, {
		levels: Set<keyof typeof levels>,
		controller: boolean,
		hostIds: Set<number>,
		instanceIds: Set<number>,
	}>;

	constructor(
		public logDirectory: string,
		serialized: any,
	) {
		this.index = new Map();

		if (serialized.version !== logIndexVersion) {
			return;
		}

		for (let [file, serializedEntry] of Object.entries(serialized.files) as [string, any][]) {
			this.index.set(file, {
				levels: new Set(serializedEntry.levels),
				controller: serializedEntry.controller,
				hostIds: new Set(serializedEntry.hostIds),
				instanceIds: new Set(serializedEntry.instanceIds),
			});
		}
	}

	serialize() {
		let serialized = {
			version: logIndexVersion,
			files: {} as Record<string, {
				levels: string[],
				controller: boolean,
				hostIds: number[],
				instanceIds: number[],
			}>,
		};

		for (let [file, entry] of this.index) {
			serialized.files[file] = {
				levels: [...entry.levels],
				controller: entry.controller,
				hostIds: [...entry.hostIds],
				instanceIds: [...entry.instanceIds],
			};
		}

		return serialized;
	}

	/**
	 * Load or create an empty index for the given directory
	 *
	 * Loads index.json from the given log directy expecting it to contain
	 * data about previously indexed files saved with {@link
	 * module:lib.LogIndex#save}.
	 *
	 * @param logDirectory - Path to directory to load from.
	 * @returns loaded or created log index.
	 */
	static async load(logDirectory: string) {
		try {
			let content = await fs.readFile(path.join(logDirectory, "index.json"));
			return new LogIndex(logDirectory, JSON.parse(content.toString()));
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				logger.warn(`Failed to load ${path.join(logDirectory, "index.json")}: ${err}`);
			}
			return new LogIndex(logDirectory, {});
		}
	}

	/**
	 * Save index
	 *
	 * Saves corrently held index into index.json in the log directory it
	 * was loaded/created from.
	 */
	async save() {
		await libFileOps.safeOutputFile(
			path.join(this.logDirectory, "index.json"),
			JSON.stringify(this.serialize(), null, "\t")
		);
	}

	async indexFile(file: string) {
		let filePath = path.join(this.logDirectory, file);
		let lineStream = new libStream.LineSplitter({ readableObjectMode: true });
		let fileStream = fs.createReadStream(filePath);
		fileStream.pipe(lineStream);
		let entry = {
			levels: new Set() as Set<keyof typeof levels>,
			controller: false,
			hostIds: new Set() as Set<number>,
			instanceIds: new Set() as Set<number>,
		};
		for await (let line of lineStream) {
			let info: any;
			try {
				info = JSON.parse(line);
			} catch (err) {
				entry.levels.add("info");
				entry.controller = true;
				continue;
			}
			if (info.level) {
				entry.levels.add(info.level);
			}
			if (info.host_id === undefined) {
				entry.controller = true;
			} else if (info.instance_id === undefined) {
				entry.hostIds.add(info.host_id);
			}
			if (info.instance_id !== undefined) {
				entry.instanceIds.add(info.instance_id);
			}
		}
		return entry;
	}

	/**
	 * Build index for files currently present in the log directory
	 */
	async buildIndex() {
		let today = new Date(Date.now() - 300e3).toISOString().slice(0, 10);

		for (let file of await fs.readdir(this.logDirectory)) {
			let match = logFileGlob.exec(file);
			if (!match || match[1] >= today || this.index.has(file)) {
				continue;
			}

			let entry = await this.indexFile(file);
			this.index.set(file, entry);
		}
	}

	/**
	 * Check if a file includes entries for the given filter
	 *
	 * @param file -
	 *     Name of file in the log directory to check for.
	 * @param filter -
	 *     Filter to check index if file contains entries for.
	 * @returns
	 *     true if the file may contain entries included by the filter.
	 */
	filterIncludesFile(file: string, { maxLevel, all, controller, instanceIds, hostIds }: LogFilter) {
		const entry = this.index.get(file);
		if (!entry) {
			return true;
		}

		const hasOwnProperty = Object.prototype.hasOwnProperty;
		if (maxLevel && hasOwnProperty.call(levels, maxLevel)) {
			let fileLevels = [...entry.levels].map(
				fileLevel => (hasOwnProperty.call(levels, fileLevel) ? levels[fileLevel] : levels.verbose)
			);
			if (fileLevels.every(level => level > levels[maxLevel])) {
				return false;
			}
		}

		if (all) {
			return true;
		}
		if (controller && entry.controller) {
			return true;
		}
		if (hostIds && hostIds.some(id => entry.hostIds.has(id))) {
			return true;
		}
		if (instanceIds && instanceIds.some(id => entry.instanceIds.has(id))) {
			return true;
		}
		return false;
	}
}

/**
 * Filter object for querying logs
 */
export interface QueryLogFilter {
	/**
	 * Maximum number of entries to return.  Defaults to 100.
	 */
	limit?: number;
	/**
	 * Return entries in ascending ("asc") date order or desceding ("desc")
	 * date order. Defaults to "asc".
	 */
	order?: "asc" | "desc";
	/**
	 * Maximum log level to include. Higher levels are more verbose.
	 */
	maxLevel?: keyof typeof levels;
	/**
	 * Include log entries from controller, all hosts and all instances.
	 */
	all: boolean;
	/**
	 * Include log entries from the controller.
	 */
	controller: boolean;
	/**
	 * Include log entries for the given hosts and instances of those
	 * hosts by id.
	 */
	hostIds: number[];
	/**
	 * Include log entries for the given instances by id.
	 */
	instanceIds: number[];
}

/**
 * Query log directory
 *
 * @param logDirectory - path to directory with logs.
 * @param filter -
 *     Filter to limit logs by.
 * @param index -
 *     Index to speed up query with.
 * @returns log entries matching the filter
 */
export async function queryLog(logDirectory: string, filter: QueryLogFilter, index: LogIndex | null) {
	let files = (await fs.readdir(logDirectory)).filter(entry => logFileGlob.test(entry));

	filter = {
		limit: 100,
		order: "asc",
		...filter,
	};

	files.sort();
	if (filter.order === "desc") {
		files.reverse();
	}

	const includeEntry = logFilter(filter);
	let log: object[] = [];
	for (let file of files) {
		if (index && !index.filterIncludesFile(file, filter)) {
			continue;
		}
		let filePath = path.join(logDirectory, file);
		let fileStream: fs.ReadStream;
		let lineStream: libStream.LineSplitter;
		if (filter.order === "asc") {
			lineStream = new libStream.LineSplitter({ readableObjectMode: true });
			fileStream = fs.createReadStream(filePath);
		} else {
			lineStream = new libStream.ReverseLineSplitter({ readableObjectMode: true });
			fileStream = await libStream.createReverseReadStream(filePath);
		}
		lineStream.on("data", line => {
			let info: any;
			try {
				info = JSON.parse(line);
			} catch (err) {
				info = { level: "info", message: line.toString("utf8") };
			}
			if (includeEntry(info)) {
				log.push(info);
				if (log.length >= Number(filter.limit)) {
					lineStream.destroy();
					fileStream.destroy();
				}
			}
		});
		fileStream.pipe(lineStream);
		try {
			await finished(lineStream);
		} catch (err: any) {
			if (log.length < Number(filter.limit) || err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
				throw err;
			}
		}

		if (log.length >= Number(filter.limit)) {
			break;
		}
	}
	return log;
}

export function handleUnhandledErrors() {
	/* eslint-disable node/no-process-exit */
	process.on("uncaughtException", err => {
		logger.fatal(`Uncaught exception:\n${err.stack}`);
		process.exit(1);
	});
	process.on("unhandledRejection", (reason: Error, _promise) => {
		logger.fatal(`Unhandled rejection:\n${reason.stack ? reason.stack : reason}`);
		process.exit(1);
	});
	/* eslint-enable node/no-process-exit */
}

// for testing only
export const _formatServerOutput = formatServerOutput;
