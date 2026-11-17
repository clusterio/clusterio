// Spec reporter controlling console output with TEST_OUTPUT:
// verbose prints everything, normal (default) prints only output from failing
// tests and hooks, silent prints only the results.
"use strict";
const util = require("node:util");
const Mocha = require("mocha");

const { Spec } = Mocha.reporters;
const { EVENT_TEST_FAIL, EVENT_TEST_PASS, EVENT_TEST_PENDING } = Mocha.Runner.constants;
const methods = ["log", "info", "debug", "warn", "error"];
const modes = ["verbose", "normal", "silent"];

class CaptureReporter extends Spec {
	constructor(runner, options) {
		super(runner, options);
		const mode = process.env.TEST_OUTPUT || "normal";
		if (!modes.includes(mode)) {
			throw new Error(`Invalid TEST_OUTPUT "${mode}", expected one of ${modes.join(", ")}`);
		}
		if (mode === "verbose") {
			return;
		}

		const original = {};
		const captured = [];
		for (const method of methods) {
			original[method] = console[method];
			console[method] = mode === "silent"
				? () => {}
				: (...args) => { captured.push([method, util.format(...args)]); };
		}

		const discard = () => { captured.length = 0; };
		runner.on(EVENT_TEST_PASS, discard);
		runner.on(EVENT_TEST_PENDING, discard);
		// Prepend so the output lands above the failure line.
		runner.prependListener(EVENT_TEST_FAIL, () => {
			for (const [method, text] of captured) {
				original[method](text);
			}
			discard();
		});
	}
}

module.exports = CaptureReporter;
