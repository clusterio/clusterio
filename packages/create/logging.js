/* eslint-disable no-console */
"use strict";
const chalk = require("chalk");

const levels = Object.freeze({
	fatal: 0,
	error: 1,
	warn: 2,
	audit: 3,
	info: 4,
	verbose: 6,
});

const colors = {
	fatal: "inverse red",
	error: "bold redBright",
	warn: "bold yellowBright",
	audit: "bold greenBright",
	info: "bold blueBright",
	verbose: "bold grey",
};

let maxLogLevel = levels.info;
const logger = {};
for (let [name, level] of Object.entries(levels)) {
	// eslint-disable-next-line no-loop-func
	logger[name] = message => {
		if (level > maxLogLevel) {
			return;
		}
		let style = chalk;
		for (let part of colors[name].split(" ")) {
			style = style[part];
		}
		if (["fatal", "error"].includes(name)) {
			console.error(`${style(name)} ${message}`);
		} else if (["warn"].includes(name)) {
			console.warn(`${style(name)} ${message}`);
		} else {
			console.log(`${style(name)} ${message}`);
		}
	};
}

module.exports = {
	colors,
	levels,
	setLogLevel: (level) => { maxLogLevel = level; },
	logger,
};

