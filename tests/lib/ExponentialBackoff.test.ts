import t, { type Test } from "tap";
import * as lib from "@clusterio/lib";

// Fix the clock and Math.random so delays are exact
function fixed(t1: Test, random = 0.5) {
	const clock = { now: 1_000_000, random };
	t1.capture(Date, "now", () => clock.now);
	t1.capture(Math, "random", () => clock.random);
	return clock;
}

// Largest value Math.random can return
const largestRandom = 1 - Number.EPSILON / 2;

function delays(backoff: lib.ExponentialBackoff, count: number) {
	return Array.from({ length: count }, () => backoff.delay());
}

t.test("ExponentialBackoff", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("defaults to base 1, max 60 and reset twice max", async t3 => {
			const backoff = new lib.ExponentialBackoff();
			t3.equal(backoff.base, 1);
			t3.equal(backoff.max, 60);
			t3.equal(backoff.reset, 120);
		});
		t2.test("takes base, max and reset", async t3 => {
			const backoff = new lib.ExponentialBackoff({ base: 2, max: 30, reset: 5 });
			t3.equal(backoff.base, 2);
			t3.equal(backoff.max, 30);
			t3.equal(backoff.reset, 5);
		});
		t2.test("defaults reset to twice the given max", async t3 => {
			t3.equal(new lib.ExponentialBackoff({ max: 10 }).reset, 20);
		});
	});

	t1.test("delay()", async t2 => {
		t2.test("doubles the delay range on each call", async t3 => {
			fixed(t3);
			const backoff = new lib.ExponentialBackoff({ max: 1024 });
			t3.strictSame(delays(backoff, 5), [1000, 2000, 4000, 8000, 16000]);
		});
		t2.test("picks a random point between 0 and the range", async t3 => {
			const clock = fixed(t3, 0);
			const backoff = new lib.ExponentialBackoff({ max: 1024 });
			t3.equal(backoff.delay(), 0);
			clock.random = 0.25;
			t3.equal(backoff.delay(), 1000);
		});
		t2.test("scales the delay by base", async t3 => {
			fixed(t3);
			const backoff = new lib.ExponentialBackoff({ base: 3, max: 1024 });
			t3.strictSame(delays(backoff, 3), [3000, 6000, 12000]);
		});
		t2.test("stops growing at max", async t3 => {
			fixed(t3);
			const backoff = new lib.ExponentialBackoff({ max: 8 });
			t3.strictSame(delays(backoff, 5), [1000, 2000, 4000, 4000, 4000]);
		});
		t2.test("never exceeds max for a max that is not a power of two", async t3 => {
			fixed(t3, largestRandom);
			const backoff = new lib.ExponentialBackoff({ max: 60 });
			t3.ok(delays(backoff, 10).every(delay => delay <= 60_000));
		});
		t2.test("never exceeds max with a base other than 1", async t3 => {
			fixed(t3, largestRandom);
			const backoff = new lib.ExponentialBackoff({ base: 5, max: 10 });
			t3.ok(delays(backoff, 5).every(delay => delay <= 10_000), "delays capped at max");
		});
		t2.test("starts over when called after more than reset seconds", async t3 => {
			const clock = fixed(t3);
			const backoff = new lib.ExponentialBackoff({ max: 1024, reset: 100 });
			t3.strictSame(delays(backoff, 3), [1000, 2000, 4000]);
			clock.now += 100_000;
			t3.equal(backoff.delay(), 8000, "exactly reset seconds is not enough");
			clock.now += 100_001;
			t3.equal(backoff.delay(), 1000);
		});
		t2.test("measures the reset time from construction for the first call", async t3 => {
			const clock = fixed(t3);
			const backoff = new lib.ExponentialBackoff({ max: 1024, reset: 10 });
			clock.now += 60_000;
			t3.equal(backoff.delay(), 1000);
		});
	});
});
