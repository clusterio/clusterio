"use strict";
const assert = require("assert").strict;

const lib = require("@clusterio/lib");


describe("lib/lua_tools", function() {
	describe("normalizeColor()", function() {
		it("should normalise colours according to the documentation", function() {
			const nc = lib.normalizeColor;
			assert.deepEqual(nc({ r: 1, g: 0.2, b: 0.4, a: 0.8 }), { r: 1, g: 0.2, b: 0.4, a: 0.8 });
			assert.deepEqual(nc({ r: 1, g: 0.2, b: 0.4 }), { r: 1, g: 0.2, b: 0.4, a: 1 });
			assert.deepEqual(nc({ r: 1, b: 0.4 }), { r: 1, g: 0, b: 0.4, a: 1 });
			assert.deepEqual(nc({ a: 0.4 }), { r: 0, g: 0, b: 0, a: 0.4 });
			assert.deepEqual(nc({}), { r: 0, g: 0, b: 0, a: 1 });
			assert.deepEqual(nc([1, 0.2, 0.4, 0.8]), { r: 1, g: 0.2, b: 0.4, a: 0.8 });
			assert.deepEqual(nc([1, 0.2, 0.4]), { r: 1, g: 0.2, b: 0.4, a: 1 });
			assert.deepEqual(nc({ r: 255, g: 51, b: 102, a: 204 }), { r: 1, g: 0.2, b: 0.4, a: 0.8 });
			assert.deepEqual(nc({ r: 255, g: 51, b: 102 }), { r: 1, g: 0.2, b: 0.4, a: 1 });
			assert.deepEqual(nc({ r: 255, b: 102 }), { r: 1, g: 0, b: 0.4, a: 1 });
			assert.deepEqual(nc({ a: 102 }), { r: 0, g: 0, b: 0, a: 0.4 });
			assert.deepEqual(nc({}), { r: 0, g: 0, b: 0, a: 1 });
			assert.deepEqual(nc([255, 51, 102, 204]), { r: 1, g: 0.2, b: 0.4, a: 0.8 });
			assert.deepEqual(nc([255, 51, 102]), { r: 1, g: 0.2, b: 0.4, a: 1 });
		});
	});
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
