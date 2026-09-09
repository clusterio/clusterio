"use strict";
const assert = require("assert").strict;

const lib = require("@clusterio/lib");

describe("lib/errors", function() {
	describe("class InvalidMessage", function() {
		it("should include validation errors in the stack", function() {
			let errors = [{ instancePath: "/value", message: "must be number" }];
			let err = new lib.InvalidMessage("Request Test failed validation", errors);
			assert.equal(err.message, "Request Test failed validation");
			assert.equal(err.errors, errors);
			assert(err.stack.startsWith("Error: Request Test failed validation\n"));
			assert(err.stack.endsWith(`\n${JSON.stringify(errors, null, "\t")}`));
		});
		it("should leave the stack alone without errors", function() {
			let err = new lib.InvalidMessage("Unrecognized request Test");
			assert.equal(err.errors, undefined);
			assert(!err.stack.includes("\n["));
			let nullErr = new lib.InvalidMessage("Unrecognized request Test", null);
			assert.equal(nullErr.errors, null);
		});
	});
});
