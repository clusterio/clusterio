"use strict";
const assert = require("assert").strict;

const { testLines } = require("./factorio/lines");
const libLoggingUtils = require("@clusterio/lib/logging_utils");


describe("lib/logging_utils.js", function() {
	describe("formatServerOutput", function() {
		it("should pass the test lines", function() {
			for (let [reference, output] of testLines) {
				let line = libLoggingUtils._formatServerOutput(output);
				// Strip colours
				line = line.replace(/\x1B\[\d+m/g, "");
				assert.deepEqual(line, reference);
			}
		});
	});
});
