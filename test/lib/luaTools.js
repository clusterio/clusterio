"use strict";
const assert = require("assert").strict;

const luaTools = require("lib/luaTools");


describe("lib/luaTools", function() {
	describe("escapeString()", function() {
		it("should escape backslashes", function() {
			assert.equal(luaTools.escapeString("\\a"), "\\\\a");
		});
		it("should escape double quotes", function() {
			assert.equal(luaTools.escapeString('"a"'), '\\"a\\"');
		});
		it("should escape single quotes", function() {
			assert.equal(luaTools.escapeString("'a'"), "\\'a\\'");
		});
		it("should escape nul bytes", function() {
			assert.equal(luaTools.escapeString("a\0b"), "a\\0b");
		});
		it("should escape newlines", function() {
			assert.equal(luaTools.escapeString("a\nb"), "a\\nb");
		});
		it("should escape carriage return", function() {
			assert.equal(luaTools.escapeString("a\rb"), "a\\rb");
		});
		it("should escape all combined", function() {
			assert.equal(luaTools.escapeString("a\\b\"c'd\0e\nf\rg"), "a\\\\b\\\"c\\'d\\0e\\nf\\rg");
		});
	});
});
