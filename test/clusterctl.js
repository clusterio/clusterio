"use strict";
const assert = require("assert").strict;
const chalk = require("chalk");

const { testLines } = require("./lib/factorio/lines");
const clusterctl = require("../clusterctl.js");


describe("clusterctl", function() {
	describe("formatOutputColored()", function() {
		it("should pass the test lines", function() {
			// Ensure tests get uncoloured output.
			let old = chalk.level;
			chalk.level = 0;

			for (let [reference, output] of testLines) {
				let line = clusterctl._formatOutputColored(output);
				assert.deepEqual(line, reference);
			}

			chalk.level = old;
		});
	});
});
