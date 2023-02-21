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
		this.filter = options.filter || (() => true);
	}

	log(info, callback) {
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

/**
 * Filter object for logs
 * @typedef {Object} module:lib/logging~LogFilter
 * @property {string} [max_level] -
 *     Maximum log level to include. Higher levels are more verbose.
 * @property {boolean} [all] -
 *     Include log entries from controller, all slaves and all instances.
 * @property {boolean} [controller] -
 *     Include log entries from the controller.
 * @property {Array<number>} [slave_ids] -
 *     Include log entries for the given slaves and instances of those
 *     slaves by id.
 * @property {Array<number>} [instance_ids] -
 *     Include log entries for the given instances by id.
 */

/**
 * Create log filter by level and source.
 *
 * @param {module:lib/logging~LogFilter} filter -
 *     Filter to filter log entries by.
 * @returns {function(object): boolean}
 *     filter returning true for log entries that match it.
 * @static
 */
function logFilter({ all, controller, slave_ids, instance_ids, max_level }) {
	return info => {
		// Note: reversed to filter out undefined levels
		if (max_level && !(levels[info.level] <= levels[max_level])) {
			return false;
		}

		if (all) {
			return true;
		}
		if (controller && info.slave_id === undefined) {
			return true;
		}
		if (
			slave_ids
			&& info.slave_id !== undefined
			&& info.instance_id === undefined
			&& slave_ids.includes(info.slave_id)
		) {
			return true;
		}
		if (instance_ids && info.instance_id !== undefined && instance_ids.includes(info.instance_id)) {
			return true;
		}
		return false;
	};
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
	logFilter,
	logger,
};
