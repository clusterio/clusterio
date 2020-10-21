"use strict";
const assert = require("assert").strict;

const libLuaTools = require("@clusterio/lib/lua_tools");


describe("lib/lua_tools", function() {
	describe("escapeString()", function() {
		it("should escape backslashes", function() {
			assert.equal(libLuaTools.escapeString("\\a"), "\\\\a");
		});
		it("should escape double quotes", function() {
			assert.equal(libLuaTools.escapeString('"a"'), '\\"a\\"');
		});
		it("should escape single quotes", function() {
			assert.equal(libLuaTools.escapeString("'a'"), "\\'a\\'");
		});
		it("should escape nul bytes", function() {
			assert.equal(libLuaTools.escapeString("a\0b"), "a\\0b");
		});
		it("should escape newlines", function() {
			assert.equal(libLuaTools.escapeString("a\nb"), "a\\nb");
		});
		it("should escape carriage return", function() {
			assert.equal(libLuaTools.escapeString("a\rb"), "a\\rb");
		});
		it("should escape all combined", function() {
			assert.equal(libLuaTools.escapeString("a\\b\"c'd\0e\nf\rg"), "a\\\\b\\\"c\\'d\\0e\\nf\\rg");
		});
	});
});
