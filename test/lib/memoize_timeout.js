"use strict";
const assert = require("assert");
const lib = require("@clusterio/lib");

describe("lib/memoize_timeout", function () {
	/**
	 * Memoize a function with a timeout.
	 * @param {Function} fn Function to memoize.
	 * @param {number} timeout Timeout in milliseconds.
	 * @returns {Function} Memoized function.
	 */
	describe("memoizeTimeout", function () {
		it("should return a memoized function", function () {
			let memoized = lib.memoizeTimeout(() => { }, 0);
			assert(typeof memoized === "function");
		});
		it("should cache results, even if the target function has sideeffects", function () {
			let i = 0;
			// Function with side effects - calling twice does not get same result
			let fn = (arg) => {
				i += arg;
				return i;
			};
			let memoized = lib.memoizeTimeout(fn, 100);

			// Memoized function should return same result for same input
			let result1 = memoized(5);
			let result2 = memoized(5);
			assert.equal(result1, result2);

			// Normal function may return different value for same input if there are sideeffects
			let result3 = fn(5);
			let result4 = fn(5);
			assert.notEqual(result3, result4);
		});
		it("supports async functions", async function () {
			let i = 0;
			let fn = async (arg) => {
				await sleep(25);
				i += arg;
				return i;
			};
			let memoized = lib.memoizeTimeout(fn, 100);

			let result1 = await memoized(5);
			let result2 = await memoized(5);
			assert.equal(result1, result2);

			// Calling in parallell should return same result with the function only called once
			let [result3, result4] = await Promise.all([memoized(1), memoized(1)]);
			assert.equal(result3, result4);
		});
		it("expires the cache after the timeout", async function () {
			let i = 0;
			let fn = (arg) => {
				i += arg;
				return i;
			};
			let memoized = lib.memoizeTimeout(fn, 10);

			let result1 = memoized(1);
			await sleep(15);
			let result2 = memoized(1);
			assert.notEqual(result1, result2);
			await sleep(5);
			let result3 = memoized(1);
			assert.equal(result2, result3);
		});
		it("handles multiple arguments", function () {
			let calls = 0;
			let fn = (a, b) => {
				calls += 1;
				return a + b;
			};
			let memoized = lib.memoizeTimeout(fn, 100);

			let result1 = memoized(1, 2);
			let result2 = memoized(1, 2);
			assert.equal(result1, result2);
			assert.equal(calls, 1);

			let result3 = memoized(2, 1);
			assert.equal(result1, result3);
			assert.equal(calls, 2);
		});
	});
});

async function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
};
