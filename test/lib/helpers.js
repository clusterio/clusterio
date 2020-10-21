"use strict";
const assert = require("assert").strict;

const libHelpers = require("@clusterio/lib/helpers");


describe("lib/helpers", function() {
	describe("basicType()", function() {
		it("should return the expected values", function() {
			assert.equal(libHelpers.basicType("s"), "string");
			assert.equal(libHelpers.basicType(null), "null");
			assert.equal(libHelpers.basicType(undefined), "undefined");
			assert.equal(libHelpers.basicType([1, 2]), "array");
			assert.equal(libHelpers.basicType(7), "number");
			assert.equal(libHelpers.basicType({ a: 1 }), "object");
		});
	});
});
