"use strict";
const assert = require("assert").strict;
const hrtime = process.hrtime.bigint;

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

	describe("wait", function() {
		it("should wait the approximate amount of time given", async function() {
			let startNs = hrtime();
			await libHelpers.wait(100);
			let duration = Number(hrtime() - startNs) / 1e6;

			assert(duration > 90 && duration < 110, `duration waited (${duration}ms) 10% of expected (100ms)`);
		});
	});

	describe("timeout", function() {
		it("should return the result of an already resolved promise", async function() {
			assert.equal(await libHelpers.timeout(Promise.resolve("value"), 10, "timeout"), "value");
		});
		it("should return the result of the promise if received before timeout", async function() {
			assert.equal(await libHelpers.timeout(
				(async () => { await libHelpers.wait(10); return "value"; })(), 20, "timeout"
			), "value");
		});
		it("should return the timeoutResult if not received before timeout", async function() {
			assert.equal(await libHelpers.timeout(
				(async () => { await libHelpers.wait(20); return "value"; })(), 10, "timeout"
			), "timeout");
		});
	});
});
