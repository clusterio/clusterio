const assert = require("assert").strict;
const { ValueCache, wait } = require("@clusterio/lib");

describe("ValueCache", function () {
	describe("constructor", function () {
		it("constructs with a fetch function", function() {
			const fetcher = async () => 42;
			const cache = new ValueCache(fetcher);
			assert.ok(cache);
		});
	});

	describe("get", function() {
		it("throws TypeError for negative maxAgeMs", async function() {
			const fetcher = async () => 42;
			const cache = new ValueCache(fetcher);

			assert.throws(() => cache.get(-1), err => {
				assert.equal(err instanceof TypeError, true);
				assert.match(String(err.message), /maxAgeMs/);
				return true;
			});
		});
		it("uses a default of 0 for maxAgeMs", async function() {
			let callCount = 0;
			const fetcher = async () => {
				callCount += 1;
				return callCount;
			};

			const cache = new ValueCache(fetcher);

			const v1 = await cache.get();
			const v2 = await cache.get();

			assert.equal(v1, 1);
			assert.equal(v2, 2);
			assert.equal(callCount, 2);
		});
		it("returns cached value when within maxAgeMs", async function() {
			let callCount = 0;
			const fetcher = async () => {
				callCount += 1;
				return callCount;
			};

			const cache = new ValueCache(fetcher);

			const v1 = await cache.get(1000);
			const v2 = await cache.get(1000);

			assert.equal(v1, 1);
			assert.equal(v2, 1);
			assert.equal(callCount, 1);
		});
		it("refreshes the cache when older than maxAgeMs", async function() {
			let callCount = 0;
			const fetcher = async () => {
				callCount += 1;
				return callCount;
			};

			const cache = new ValueCache(fetcher);

			const v1 = await cache.get(50);
			const v2 = await cache.get(1000); // Use cached value
			await wait(100);
			const v3 = await cache.get(50); // Stale after 100ms wait
			const v4 = await cache.get(1000); // Use cached value

			assert.equal(v1, 1);
			assert.equal(v2, 1);
			assert.equal(v3, 2);
			assert.equal(v4, 2);
			assert.equal(callCount, 2);
		});
		it("shares in-flight fetch between concurrent callers", async function() {
			let callCount = 0;
			let resolveFetcher;
			const fetcher = () => (
				new Promise(resolve => {
					callCount += 1;
					resolveFetcher = resolve;
				})
			);

			const cache = new ValueCache(fetcher);

			const p1 = cache.get(1000);
			const p2 = cache.get(1000);

			assert.equal(callCount, 1);

			resolveFetcher(42);
			const [v1, v2] = await Promise.all([p1, p2]);

			assert.equal(v1, 42);
			assert.equal(v2, 42);
			assert.equal(callCount, 1);
		});
		it("propagates errors from the fetcher and clears ongoing fetch", async function() {
			let callCount = 0;
			const error = new Error("fetch failed");
			const fetcher = async () => {
				callCount += 1;
				throw error;
			};

			const cache = new ValueCache(fetcher);

			await assert.rejects(cache.get(), err => {
				assert.equal(err, error);
				return true;
			});

			assert.equal(callCount, 1);

			// After a failure, a new attempt to fetch should be made
			await assert.rejects(cache.get(), err => {
				assert.equal(err, error);
				return true;
			});

			assert.equal(callCount, 2);
		});
	});
});
