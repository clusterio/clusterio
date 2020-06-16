"use strict";
const assert = require("assert").strict;

const helpers = require("lib/helpers");


describe("lib/helpers", function() {
    describe("basicType()", function() {
        it("should return the expected values", function() {
            assert.equal(helpers.basicType("s"), "string");
            assert.equal(helpers.basicType(null), "null");
            assert.equal(helpers.basicType(undefined), "undefined");
            assert.equal(helpers.basicType([1, 2]), "array");
            assert.equal(helpers.basicType(7), "number");
            assert.equal(helpers.basicType({ a: 1 }), "object");
        });
    });
});
