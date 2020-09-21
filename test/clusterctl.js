"use strict";
const assert = require("assert").strict;

const { testLines } = require("./lib/factorio/lines");
const clusterctl = require("@clusterio/ctl/clusterctl.js");


describe("clusterctl", function() {
	describe("formatOutputColored()", function() {
		it("should pass the test lines", function() {
			for (let [reference, output] of testLines) {
				let line = clusterctl._formatOutputColored(output);
				// Strip colours
				line = line.replace(/\x1B\[\d+m/g, "");
				assert.deepEqual(line, reference);
			}
		});
	});
});
