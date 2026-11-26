import t, { type Test } from "tap";
import * as lib from "@clusterio/lib";

function fakeNow(t1: Test, start = 10_000) {
	const clock = { now: start };
	t1.capture(Date, "now", () => clock.now);
	return clock;
}

// Cache whose fetches return 1, 2, 3, ... and count calls
function counting() {
	const state = { calls: 0 };
	const cache = new lib.ValueCache(async () => {
		state.calls += 1;
		return state.calls;
	});
	return { cache, state };
}

t.test("ValueCache", async t1 => {
	t1.test("get()", async t2 => {
		t2.test("rejects a negative maxAgeMs", async t3 => {
			const { cache, state } = counting();
			t3.throws(() => cache.get(-1), new TypeError("maxAgeMs must be a non-negative number"));
			t3.equal(state.calls, 0);
		});
		t2.test("fetches every time by default", async t3 => {
			fakeNow(t3);
			const { cache, state } = counting();
			t3.equal(await cache.get(), 1);
			t3.equal(await cache.get(), 2);
			t3.equal(state.calls, 2);
		});
		t2.test("returns the cached value while younger than maxAgeMs", async t3 => {
			const clock = fakeNow(t3);
			const { cache } = counting();
			t3.equal(await cache.get(1000), 1);
			clock.now += 999;
			t3.equal(await cache.get(1000), 1);
			t3.equal(await cache.get(2000), 1);
		});
		t2.test("fetches again once the value is maxAgeMs old", async t3 => {
			const clock = fakeNow(t3);
			const { cache } = counting();
			t3.equal(await cache.get(1000), 1);
			clock.now += 1000;
			t3.equal(await cache.get(1000), 2);
			t3.equal(await cache.get(1000), 2);
		});
		t2.test("ages the value from when the fetch finished", async t3 => {
			const clock = fakeNow(t3);
			let calls = 0;
			const cache = new lib.ValueCache(async () => {
				calls += 1;
				clock.now += 500;
				return calls;
			});
			t3.equal(await cache.get(), 1);
			t3.equal(await cache.get(400), 1, "fetch took 500ms but finished 0ms ago");
		});
		t2.test("shares a fetch in flight between callers", async t3 => {
			fakeNow(t3);
			let calls = 0;
			let resolve!: (value: number) => void;
			const cache = new lib.ValueCache(() => new Promise<number>(r => { calls += 1; resolve = r; }));
			const first = cache.get();
			const second = cache.get(1000);
			t3.equal(calls, 1);
			resolve(42);
			t3.strictSame(await Promise.all([first, second]), [42, 42]);
		});
		t2.test("passes on fetch errors and fetches again on the next call", async t3 => {
			fakeNow(t3);
			let calls = 0;
			const cache = new lib.ValueCache<number>(async () => {
				calls += 1;
				if (calls === 1) {
					throw new Error("fetch failed");
				}
				return calls;
			});
			await t3.rejects(cache.get(1000), new Error("fetch failed"));
			t3.equal(await cache.get(1000), 2);
		});
		t2.test("keeps the old value after a failed refresh", async t3 => {
			const clock = fakeNow(t3);
			let fail = false;
			const cache = new lib.ValueCache(async () => {
				if (fail) {
					throw new Error("fetch failed");
				}
				return "old";
			});
			await cache.get();
			fail = true;
			await t3.rejects(cache.get(), new Error("fetch failed"));
			clock.now += 10;
			t3.equal(await cache.get(1000), "old");
		});
	});
});
