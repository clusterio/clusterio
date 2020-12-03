"use strict";
const assert = require("assert").strict;

const { wait } = require("@clusterio/lib/helpers");
const RateLimiter = require("@clusterio/lib/RateLimiter");


describe("lib/RateLimiter", function() {
	describe("class RateLimiter", function() {
		let rateLimiter;
		beforeEach(function() {
			rateLimiter = new RateLimiter();
		});
		afterEach(function() {
			rateLimiter.cancel();
		});

		it("should rate limit activations", function() {
			assert(rateLimiter.activate(), "fist invocation was rate limited");
			assert(!rateLimiter.activate(), "second invocation was not rate limited");
		});

		it("should invoke action immediately when not rate limited", function() {
			let invoked = false;
			rateLimiter.action = () => { invoked = true; };
			rateLimiter.activate();
			assert(invoked, "action was not invoked");
		});

		it("should invoke action at a later point in time if rate limited", async function() {
			let invokedCount = 0;
			rateLimiter.maxRate = 100;
			rateLimiter.action = () => { invokedCount += 1; };
			rateLimiter.activate();
			rateLimiter.activate();
			assert.equal(invokedCount, 1, "expected one invocation");
			await wait(20);
			assert.equal(invokedCount, 2, "expected two invocations");
		});

		it("should invoke action before timeout if maxRate changed", async function() {
			let invokedCount = 0;
			rateLimiter.action = () => { invokedCount += 1; };
			rateLimiter.activate();
			rateLimiter.activate();
			assert.equal(invokedCount, 1, "expected one invocation");
			await wait(20);
			rateLimiter.maxRate = 100;
			rateLimiter.activate();
			assert.equal(invokedCount, 2, "expected two invocations");
		});

		it("should cancel action if canceled before timeout", async function() {
			let invokedCount = 0;
			rateLimiter.action = () => { invokedCount += 1; };
			rateLimiter.activate();
			rateLimiter.activate();
			rateLimiter.cancel();
			assert.equal(invokedCount, 1, "expected one invocation");
			await wait(20);
			assert.equal(invokedCount, 1, "expected one invocation");
		});
	});
});
