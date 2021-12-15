"use strict";
const events = require("events");
const fs = require("fs-extra");
const path = require("path");
const winston = require("winston");
const Transport = require("winston-transport");
const { LEVEL, MESSAGE } = require("triple-beam");
const chalk = require("chalk");

const libLink = require("./link");
const libErrors = require("./errors");
const libStream = require("./stream");


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

		} else if (info.slave_name) {
			src += `s:${info.slave_name} `;
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

async function migrateLogs(log, directory, pattern) {
	const dateRegExp = /^\d{4}-\d{2}-\d{2}/;
	let lineStream = new libStream.LineSplitter({ readableObjectMode: true });
	let fileStream = fs.createReadStream(log);
	fileStream.pipe(lineStream);

	let currentDate = null;
	let output = null;

	async function switchOutput(newOutputPath) {
		if (output) {
			output.end();
			await events.once(output, "close");
		}

		output = fs.createWriteStream(newOutputPath, { flags: "ax" });
		try {
			await events.once(output, "open");
			// eslint-disable-next-line no-console
			console.log(`writing ${newOutputPath}`);
		} catch (err) {
			if (err.code === "EEXIST") {
				// eslint-disable-next-line no-console
				console.warn(`Discarding logs for ${newDate} due to target logfile already existing`);
				output = null;
			} else {
				throw err;
			}
		}
	}

	for await (let line of lineStream) {
		let info = {};
		try {
			info = JSON.parse(line);
		} catch (err) {
			// Ignore
		}

		if (typeof info.timestamp === "string" && dateRegExp.test(info.timestamp)) {
			let newDate = info.timestamp.slice(0, 10);
			// Only update date forward in time.
			if (newDate !== currentDate && (!currentDate || newDate > currentDate)) {
				await switchOutput(path.join(directory, pattern.replace("%DATE%", newDate)));
				currentDate = newDate;
			}
		}

		if (output) {
			if (!output.write(Buffer.concat([line, Buffer.from("\n")]))) {
				await events.once(output, "drain");
			}
		}
	}
}


module.exports = {
	TerminalFormat,
	LinkTransport,
	migrateLogs,

	// for testing only
	_formatServerOutput: formatServerOutput,
};
