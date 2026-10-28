import assert from "node:assert/strict";
import FailureLimiter from "@clusterio/controller/dist/node/src/FailureLimiter.js";

describe("controller/src/FailureLimiter", function() {
	it("should block an address after the maximum failures", function() {
		const limiter = new FailureLimiter(3, 1000);
		assert.equal(limiter.fail("10.0.0.1", 0), false);
		assert.equal(limiter.fail("10.0.0.1", 0), false);
		assert.equal(limiter.blockedForMs("10.0.0.1", 0), 0);
		assert.equal(limiter.fail("10.0.0.1", 0), true);
		assert.equal(limiter.blockedForMs("10.0.0.1", 100), 900);
		assert.equal(limiter.blockedForMs("10.0.0.2", 100), 0);
	});
	it("should unblock once the window has passed", function() {
		const limiter = new FailureLimiter(1, 1000);
		limiter.fail("10.0.0.1", 0);
		assert.equal(limiter.blockedForMs("10.0.0.1", 999), 1);
		assert.equal(limiter.blockedForMs("10.0.0.1", 1000), 0);
		assert.equal(limiter.fail("10.0.0.1", 1000), true);
	});
	it("should group IPv6 addresses by /64 prefix", function() {
		assert.equal(FailureLimiter.key("2001:db8:1:2:3:4:5:6"), "2001:0db8:0001:0002::/64");
		assert.equal(FailureLimiter.key("2001:db8:1:2::ffff"), "2001:0db8:0001:0002::/64");
		assert.equal(FailureLimiter.key("::1"), "0000:0000:0000:0000::/64");
		assert.equal(FailureLimiter.key("::ffff:10.0.0.1"), "10.0.0.1");
		const limiter = new FailureLimiter(2, 1000);
		limiter.fail("2001:db8:1:2::1", 0);
		limiter.fail("2001:db8:1:2::2", 0);
		assert(limiter.blockedForMs("2001:db8:1:2::3", 0) > 0);
		assert.equal(limiter.blockedForMs("2001:db8:1:3::1", 0), 0);
	});
	it("should block new addresses when the entry cap is reached", function() {
		const limiter = new FailureLimiter(5, 1000, 2);
		limiter.fail("10.0.0.1", 0);
		limiter.fail("10.0.0.2", 0);
		assert.equal(limiter.blockedForMs("10.0.0.1", 0), 0);
		assert.equal(limiter.blockedForMs("10.0.0.3", 0), 1000);
		assert.equal(limiter.fail("10.0.0.3", 0), false);
		assert.equal(limiter.entries.size, 2);
		assert.equal(limiter.blockedForMs("10.0.0.3", 1000), 0);
		assert.equal(limiter.entries.size, 0);
	});
});
