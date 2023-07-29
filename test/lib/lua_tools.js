"use strict";
const assert = require("assert").strict;

const lib = require("@clusterio/lib");


describe("lib/lua_tools", function() {
	describe("escapeString()", function() {
		it("should escape backslashes", function() {
			assert.equal(lib.escapeString("\\a"), "\\\\a");
		});
		it("should escape double quotes", function() {
			assert.equal(lib.escapeString('"a"'), '\\"a\\"');
		});
		it("should escape single quotes", function() {
			assert.equal(lib.escapeString("'a'"), "\\'a\\'");
		});
		it("should escape nul bytes", function() {
			assert.equal(lib.escapeString("a\0b"), "a\\0b");
		});
		it("should escape newlines", function() {
			assert.equal(lib.escapeString("a\nb"), "a\\nb");
		});
		it("should escape carriage return", function() {
			assert.equal(lib.escapeString("a\rb"), "a\\rb");
		});
		it("should escape all combined", function() {
			assert.equal(lib.escapeString("a\\b\"c'd\0e\nf\rg"), "a\\\\b\\\"c\\'d\\0e\\nf\\rg");
		});
	});
});
