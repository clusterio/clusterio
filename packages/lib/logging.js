"use strict";
const winston = require("winston");
const Transport = require("winston-transport");
const { LEVEL, MESSAGE } = require("triple-beam");

const levels = Object.freeze({
	fatal: 0,
	error: 1,
	warn: 2,
	audit: 3,
	info: 4,
	server: 5,
	verbose: 6,
});

const colors = {
	fatal: "inverse red",
	error: "bold brightRed",
	warn: "bold brightYellow",
	audit: "bold brightGreen",
	info: "bold brightBlue",
	server: "bold",
	verbose: "bold grey",
};
winston.addColors(colors);

// The Console Transport is replicated here because it's overly complicated
// in winston, writes to stdout/err instead of console and doesn't work in
// the browser.
class ConsoleTransport extends Transport {
	constructor(options = {}) {
		super(options);
		this.errorLevels = new Set(options.errorLevels || ["fatal", "error"]);
		this.warnLevels = new Set(options.warnLevels || ["warn"]);
	}

	log(info, callback) {
		/* eslint-disable no-console */
		if (this.errorLevels.has(info[LEVEL])) {
			console.error(info[MESSAGE]);
		} else if (this.warnLevels.has(info[LEVEL])) {
			console.warn(info[MESSAGE]);
		} else {
			console.log(info[MESSAGE]);
		}
		/* eslint-enable no-console */
		callback();
	}
}

/**
 * Formats winston log messages for the web console
 */
class WebConsoleFormat {
	constructor(options = {}) {
		this.options = options;
	}

	transform(info, options) {
		let src = " ";
		if (info.slave_id !== undefined) {
			src += `s:${info.slave_name} - `;
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

const logger = winston.createLogger({
	level: "verbose",
	levels,
	format: winston.format.timestamp(),
});

module.exports = {
	ConsoleTransport,
	WebConsoleFormat,
	colors,
	levels,
	logger,
};
