"use strict";
const assert = require("assert").strict;

const lib = require("@clusterio/lib");

describe("lib/errors", function() {
	describe("class ExpectedError", function() {
		it("should default the code to the class name", function() {
			let err = new lib.ExpectedError("Something failed");
			assert.equal(err.code, "ExpectedError");
			assert.equal(err.message, "Something failed");
		});
		it("should be extended by the errors passed back to requesters", function() {
			assert(new lib.PermissionError("Denied") instanceof lib.ExpectedError);
			assert(new lib.InvalidAccess("Denied") instanceof lib.ExpectedError);
			assert(new lib.InvalidValue("Bad") instanceof lib.ExpectedError);
			assert(new lib.InvalidField("Bad") instanceof lib.ExpectedError);
		});
		it("should still be available under the deprecated RequestError name", function() {
			assert.equal(lib.RequestError, lib.ExpectedError);
			assert(new lib.RequestError("Old name") instanceof lib.ExpectedError);
		});
	});
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
