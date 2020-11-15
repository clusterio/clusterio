/**
 * Collection of small utilites that are useful in multiple places.
 * @module lib/helpers
 */
"use strict";

/**
 * Return a string describing the type of the value passed
 *
 * Works the same as typeof, excpet that null and array types get their
 * own string.
 *
 * @param {*} value - value to return the type of.
 * @returns {string} basic type of the value passed.
 */
function basicType(value) {
	if (value === null) { return "null"; }
	if (value instanceof Array) { return "array"; }
	return typeof value;
}


/**
 * Asynchronously wait for the given duration
 *
 * @param {number} duration - Time to wait for in milliseconds.
 */
async function wait(duration) {
	await new Promise(resolve => { setTimeout(resolve, duration); });
}


/**
 * Resolve a promise with a timeout.
 *
 * @param {Promise} promise - Promise to wait for.
 * @param {number} time - Maximum time im milliseconds to wait for.
 * @param {*=} timeoutResult - Value to return if the operation timed out.
 */
async function timeout(promise, time, timeoutResult) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise(resolve => {
				timer = setTimeout(() => resolve(timeoutResult), time);
			}),
		]);

	} finally {
		clearTimeout(timer);
	}
}

module.exports = {
	basicType,
	wait,
	timeout,
};
