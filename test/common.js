"use strict";
const assert = require("assert").strict;

/**
 * Generate a flat array of tests from a matrix of inputs.
 *
 * @template {any[][]} T
 * @param {T} arrays - A list of arrays representing the different values for each argument
 * @returns {Array<{ [K in keyof T]: T[K][number] }>}
 * 		An array of tuples, each containing one value from each input array.
 */
function testMatrix(...arrays) {
	return arrays.reduce((acc, curr) => acc.flatMap(a => curr.map(b => [...a, b])), [[]]);
}

/**
 * Test that a class is round trip json serialisable across multiple test cases.
 *
 * @template {any[]} T - Constructor arguments
 * @param {{new(...args: T): object}} Class - The class which has toJSON and fromJSON methods.
 * @param {T[]} tests - The tests inputs to pass to the class constructor.
 */
function testRoundTripJsonSerialisable(Class, tests) {
	for (const test of tests) {
		const original = new Class(...test);
		const serialised = JSON.stringify(original);
		const reconstructed = Class.fromJSON(JSON.parse(serialised));
		assert.deepEqual(reconstructed, original, JSON.stringify(test));
	}
}

module.exports = {
	testMatrix,
	testRoundTripJsonSerialisable,
};
