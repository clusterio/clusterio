// Spec reporter that holds back console output and prints it only for
// failing tests and hooks. Set VERBOSE_TEST to print everything as it happens.
"use strict";
const util = require("node:util");
const Mocha = require("mocha");

const { Spec } = Mocha.reporters;
const { EVENT_TEST_FAIL, EVENT_TEST_PASS, EVENT_TEST_PENDING } = Mocha.Runner.constants;
const methods = ["log", "info", "debug", "warn", "error"];

class CaptureReporter extends Spec {
	constructor(runner, options) {
		super(runner, options);
		if (process.env.VERBOSE_TEST) {
			return;
		}

		const original = {};
		const captured = [];
		for (const method of methods) {
			original[method] = console[method];
			console[method] = (...args) => { captured.push([method, util.format(...args)]); };
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
