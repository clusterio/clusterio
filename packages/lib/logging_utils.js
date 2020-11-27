"use strict";
const winston = require("winston");
const Transport = require("winston-transport");
const { LEVEL, MESSAGE } = require("triple-beam");
const chalk = require("chalk");

const libLink = require("@clusterio/lib/link");
const libErrors = require("@clusterio/lib/errors");


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
		time = chalk.yellow(parsed.time.padStart(8)) + " ";
	} else if (parsed.format === "date") {
		time = chalk.yellow(parsed.time) + " ";
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

		info = level + " " + chalk.gray(parsed.file) + ": ";

	} else if (parsed.type === "action") {
		info = "[" + chalk.yellow(parsed.action) + "] ";
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
			info[MESSAGE] = `[${info.level}]${src}${info.stack}`;
		} else {
			info[MESSAGE] = `[${info.level}]${src}${info.message}`;
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


module.exports = {
	TerminalFormat,
	LinkTransport,

	// for testing only
	_formatServerOutput: formatServerOutput,
};
