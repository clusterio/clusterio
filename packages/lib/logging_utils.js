/**
 * Utilities for logging on the Node.js side
 *
 * @author Hornwitser
 * @module lib/logging_utils
 */
"use strict";
const events = require("events");
const fs = require("fs-extra");
const path = require("path");
const stream = require("stream");
const util = require("util");
const winston = require("winston");
const Transport = require("winston-transport");
const { LEVEL, MESSAGE } = require("triple-beam");
const chalk = require("chalk");

const libLink = require("./link");
const libErrors = require("./errors");
const libFileOps = require("./file_ops");
const { levels, logFilter, logger } = require("./logging");
const libStream = require("./stream");

const finished = util.promisify(stream.finished);


/**
 * Format a parsed Factorio message with colors
 *
 * Formats a parsed Factorio output from lib/factorio into a readable
 * colorized output using terminal escape codes that can be printed.
 *
 * @param {Object} parsed - Parsed Factorio server output.
 * @returns {string} terminal colorized message.
 * @private
 */
function formatServerOutput(parsed) {
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
 * @static
 */
class TerminalFormat {
	constructor(options = {}) {
		this.options = options;
		this.colorize = winston.format.colorize(options);
	}

	transform(info, options) {
		info = this.colorize.transform(info, this.colorize.options);
		let ts = "";
		if (options.showTimestamp && info.timestamp) {
			ts = `${info.timestamp.replace("T", " ")} `;
		}

		let src = " ";
		if (info.instance_name) {
			src += `i:${info.instance_name} `;

		} else if (info.host_name) {
			src += `s:${info.host_name} `;
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
 * @static
 */
class LinkTransport extends Transport {
	constructor(options) {
		super(options);

		this.link = options.link;
		this.filter = options.filter || null;
	}

	log(info, callback) {
		if (this.filter && !this.filter(info)) {
			return callback();
		}

		try {
			libLink.messages.logMessage.send(this.link, { info });
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

/**
 * Keeps an index over a log directory to speed up queries to it
 * @static
 */
class LogIndex {
	constructor(logDirectory, serialized) {
		this.logDirectory = logDirectory;
		this.index = new Map();

		if (serialized.version !== 0) {
			return;
		}

		for (let [file, serializedEntry] of Object.entries(serialized.files)) {
			this.index.set(file, {
				levels: new Set(serializedEntry.levels),
				controller: serializedEntry.controller,
				host_ids: new Set(serializedEntry.host_ids),
				instance_ids: new Set(serializedEntry.instance_ids),
			});
		}
	}

	serialize() {
		let serialized = {
			version: 0,
			files: {},
		};

		for (let [file, entry] of this.index) {
			serialized.files[file] = {
				levels: [...entry.levels],
				controller: entry.controller,
				host_ids: [...entry.host_ids],
				instance_ids: [...entry.instance_ids],
			};
		}

		return serialized;
	}

	/**
	 * Load or create an empty index for the given directory
	 *
	 * Loads index.json from the given log directy expecting it to contain
	 * data about previously indexed files saved with {@link
	 * module:lib/logging_utils.LogIndex#save}.
	 *
	 * @param {string} logDirectory - Path to directory to load from.
	 * @returns {Promise<module:lib/logging_utils.LogIndex>} loaded or created log index.
	 */
	static async load(logDirectory) {
		try {
			let content = await fs.readFile(path.join(logDirectory, "index.json"));
			return new LogIndex(logDirectory, JSON.parse(content));
		} catch (err) {
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
			JSON.stringify(this.serialize(), null, 4)
		);
	}

	async indexFile(file) {
		let filePath = path.join(this.logDirectory, file);
		let lineStream = new libStream.LineSplitter({ readableObjectMode: true });
		let fileStream = fs.createReadStream(filePath);
		fileStream.pipe(lineStream);
		let entry = {
			levels: new Set(),
			controller: false,
			host_ids: new Set(),
			instance_ids: new Set(),
		};
		for await (let line of lineStream) {
			let info;
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
				entry.host_ids.add(info.host_id);
			}
			if (info.instance_id !== undefined) {
				entry.instance_ids.add(info.instance_id);
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
	 * @param {string} file -
	 *     Name of file in the log directory to check for.
	 * @param {module:lib/logging~LogFilter} filter -
	 *     Filter to check index if file contains entries for.
	 * @returns {boolean}
	 *     true if the file may contain entries included by the filter.
	 */
	filterIncludesFile(file, { max_level, all, controller, instance_ids, host_ids }) {
		let entry = this.index.get(file);
		if (!entry) {
			return true;
		}

		const hasOwnProperty = Object.prototype.hasOwnProperty;
		if (max_level && hasOwnProperty.call(levels, max_level)) {
			let fileLevels = [...entry.levels].map(
				fileLevel => (hasOwnProperty.call(levels, fileLevel) ? levels[fileLevel] : levels.verbose)
			);
			if (fileLevels.every(level => level > levels[max_level])) {
				return false;
			}
		}

		if (all) {
			return true;
		}
		if (controller && entry.controller) {
			return true;
		}
		if (host_ids && host_ids.some(id => entry.host_ids.has(id))) {
			return true;
		}
		if (instance_ids && instance_ids.some(id => entry.instance_ids.has(id))) {
			return true;
		}
		return false;
	}
}

/**
 * Filter object for querying logs
 * @typedef {Object} module:lib/logging_utils~QueryLogFilter
 * @property {number} [limit=100] - Maximum number of entries to return.
 * @property {string} [order="asc"] -
 *     Return entries in ascending ("asc") date order or desceding ("desc")
 *     date order.
 * @property {string} [max_level] -
 *     Maximum log level to include. Higher levels are more verbose.
 * @property {boolean} [all] -
 *     Include log entries from controller, all hosts and all instances.
 * @property {boolean} [controller] -
 *     Include log entries from the controller.
 * @property {Array<number>} [host_ids] -
 *     Include log entries for the given hosts and instances of those
 *     hosts by id.
 * @property {Array<number>} [instance_ids] -
 *     Include log entries for the given instances by id.
 */

/**
 * Query log directory
 *
 * @param {string} logDirectory - path to directory with logs.
 * @param {module:lib/logging_utils~QueryLogFilter} filter -
 *     Filter to limit logs by.
 * @param {module:lib/logging_utils.LogIndex=} index -
 *     Index to speed up query with.
 * @returns {Promise<Array<Object>>} log entries matching the filter
 */
async function queryLog(logDirectory, filter, index) {
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
	let log = [];
	for (let file of files) {
		if (index && !index.filterIncludesFile(file, filter)) {
			continue;
		}
		let filePath = path.join(logDirectory, file);
		let fileStream;
		let lineStream;
		if (filter.order === "asc") {
			lineStream = new libStream.LineSplitter({ readableObjectMode: true });
			fileStream = fs.createReadStream(filePath);
		} else {
			lineStream = new libStream.ReverseLineSplitter({ readableObjectMode: true });
			fileStream = await libStream.createReverseReadStream(filePath);
		}
		lineStream.on("data", line => {
			let info;
			try {
				info = JSON.parse(line);
			} catch (err) {
				info = { level: "info", message: line.toString("utf8") };
			}
			if (includeEntry(info)) {
				log.push(info);
				if (log.length >= filter.limit) {
					lineStream.destroy();
					fileStream.destroy();
				}
			}
		});
		fileStream.pipe(lineStream);
		try {
			await finished(lineStream);
		} catch (err) {
			if (log.length < filter.limit || err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
				throw err;
			}
		}

		if (log.length >= filter.limit) {
			break;
		}
	}
	return log;
}

function handleUnhandledErrors() {
	/* eslint-disable node/no-process-exit */
	process.on("uncaughtException", err => {
		logger.fatal(`Uncaught exception:\n${err.stack}`);
		process.exit(1);
	});
	process.on("unhandledRejection", (reason, promise) => {
		logger.fatal(`Unhandled rejection:\n${reason.stack ? reason.stack : reason}`);
		process.exit(1);
	});
	/* eslint-enable node/no-process-exit */
}


module.exports = {
	TerminalFormat,
	LinkTransport,
	LogIndex,
	handleUnhandledErrors,
	queryLog,

	// for testing only
	_formatServerOutput: formatServerOutput,
};
