"use strict";
const assert = require("assert").strict;

const { ExponentialBackoff } = require("@clusterio/lib");

describe("lib/ExponentialBackoff", function() {
	describe("class ExponentialBackoff", function() {
		it("should give a delay", function() {
			let backoff = new ExponentialBackoff();
			assert.equal(typeof backoff.delay(), "number");
		});

		it("should give exponentially increasing delays", function() {
			let buckets = [];
			for (let i = 0; i < 100; i++) {
				let backoff = new ExponentialBackoff({ base: 1, max: 1024 });
				for (let j = 0; j < 10; j++) {
					buckets[j] = (buckets[j] || 0) + backoff.delay();
				}
			}

			for (let i = 0; i < 10; i++) {
				let average = buckets[i] / 100 / 1000; // Divide by 1000 for ms to s conversion.
				let scale = 2 ** i;
				// Eyeball statistics told me that a deviation of about 40%
				// of the expected average would be 6 standard deviations
				// for a sum of 100 values and thus highly improbable.
				assert(
					average / scale > 0.6 && average / scale < 1.4,
					`Expected average to be in range ${scale * 0.6} to ${scale * 1.4} but got ${average}`
				);
			}
		});

		it("should not exceed max value", function() {
			for (let max of [0.1, 0.5, 1, 2, 50, 100, 1000, 100000]) {
				let backoff = new ExponentialBackoff({ base: 1, max });
				for (let j = 0; j < 100; j++) {
					let value = backoff.delay() / 1000; // Divide by 100 for ms to s conversion
					assert(value <= max, `delay returned a value greater than max: ${value} > ${max}`);
				}
			}
		});

		it("should reset if enough time passes", function() {
			let backoff = new ExponentialBackoff({ reset: 100 });
			backoff.delay();
			assert.equal(backoff._exp, 1);
			backoff._lastInvocationTime = Date.now() - 99 * 1000;
			backoff.delay();
			assert.equal(backoff._exp, 2);
			backoff._lastInvocationTime = Date.now() - 101 * 1000;
			backoff.delay();
			assert.equal(backoff._exp, 1);
		});
	});
});
