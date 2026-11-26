import t, { type Test } from "tap";
import * as lib from "@clusterio/lib";

// Replace Date.now and the global timer functions with a clock advanced by hand
function fakeClock(t1: Test, start = 10_000) {
	const clock = {
		now: start,
		timers: new Map<number, { at: number, fn: () => void }>(),
		nextId: 1,
		advance(ms: number) {
			clock.now += ms;
			for (const [id, timer] of [...clock.timers].sort((a, b) => a[1].at - b[1].at)) {
				if (timer.at <= clock.now && clock.timers.delete(id)) {
					timer.fn();
				}
			}
		},
	};
	t1.capture(Date, "now", () => clock.now);
	t1.intercept(globalThis, "setTimeout", {
		value: (fn: () => void, ms: number) => {
			const id = clock.nextId;
			clock.nextId += 1;
			clock.timers.set(id, { at: clock.now + ms, fn });
			return id;
		},
	});
	t1.intercept(globalThis, "clearTimeout", { value: (id: number) => { clock.timers.delete(id); } });
	return clock;
}

function counter(options: { maxRate?: number } = {}) {
	const state = { count: 0 };
	const limiter = new lib.RateLimiter({ ...options, action: () => { state.count += 1; } });
	return { limiter, state };
}

t.test("RateLimiter", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("defaults to one activation per second and no action", async t3 => {
			const limiter = new lib.RateLimiter();
			t3.equal(limiter.maxRate, 1);
			t3.equal(limiter.action, undefined);
		});
		t2.test("takes maxRate and action", async t3 => {
			const action = () => {};
			const limiter = new lib.RateLimiter({ maxRate: 5, action });
			t3.equal(limiter.maxRate, 5);
			t3.equal(limiter.action, action);
		});
	});

	t1.test("activate()", async t2 => {
		t2.test("runs the action right away when within the limit", async t3 => {
			fakeClock(t3);
			const { limiter, state } = counter();
			t3.equal(limiter.activate(), true);
			t3.equal(state.count, 1);
		});
		t2.test("delays activations over the limit to when they fit", async t3 => {
			const clock = fakeClock(t3);
			const { limiter, state } = counter({ maxRate: 2 });
			limiter.activate();
			clock.advance(100);
			t3.equal(limiter.activate(), false);
			t3.equal(state.count, 1, "not run yet");
			clock.advance(399);
			t3.equal(state.count, 1, "not run before 500ms have passed");
			clock.advance(1);
			t3.equal(state.count, 2, "run 500ms after the first");
		});
		t2.test("runs the action once for many activations over the limit", async t3 => {
			const clock = fakeClock(t3);
			const { limiter, state } = counter();
			for (let i = 0; i < 100; i++) {
				limiter.activate();
			}
			t3.equal(state.count, 1);
			t3.equal(clock.timers.size, 1);
			clock.advance(1000);
			t3.equal(state.count, 2);
		});
		t2.test("counts the delayed run against the limit", async t3 => {
			const clock = fakeClock(t3);
			const { limiter, state } = counter();
			limiter.activate();
			limiter.activate();
			clock.advance(1000);
			t3.equal(state.count, 2);
			t3.equal(limiter.activate(), false, "too soon after the delayed run");
			clock.advance(1000);
			t3.equal(state.count, 3);
		});
		t2.test("replaces the pending run when activated within the limit first", async t3 => {
			const clock = fakeClock(t3);
			const { limiter, state } = counter();
			limiter.activate();
			limiter.activate();
			limiter.maxRate = 10;
			clock.now += 100;
			t3.equal(limiter.activate(), true);
			t3.equal(state.count, 2);
			t3.equal(clock.timers.size, 0, "pending run cleared");
			clock.advance(1000);
			t3.equal(state.count, 2);
		});
		t2.test("still rate limits without an action", async t3 => {
			const clock = fakeClock(t3);
			const limiter = new lib.RateLimiter();
			t3.equal(limiter.activate(), true);
			t3.equal(limiter.activate(), false);
			t3.equal(clock.timers.size, 0, "nothing to schedule");
			clock.now += 1000;
			t3.equal(limiter.activate(), true);
		});
		t2.test("skips the delayed run if the action was removed", async t3 => {
			const clock = fakeClock(t3);
			const { limiter, state } = counter();
			limiter.activate();
			limiter.activate();
			limiter.action = undefined;
			clock.advance(1000);
			t3.equal(state.count, 1);
			t3.equal(limiter.activate(), false, "the delayed slot still counts");
		});
	});

	t1.test("cancel()", async t2 => {
		t2.test("cancels the pending run", async t3 => {
			const clock = fakeClock(t3);
			const { limiter, state } = counter();
			limiter.activate();
			limiter.activate();
			limiter.cancel();
			clock.advance(5000);
			t3.equal(state.count, 1);
		});
		t2.test("does nothing without a pending run", async t3 => {
			const clock = fakeClock(t3);
			const { limiter, state } = counter();
			limiter.cancel();
			limiter.activate();
			limiter.cancel();
			clock.advance(5000);
			t3.equal(state.count, 1);
		});
		t2.test("allows activations over the limit to schedule a run again", async t3 => {
			const clock = fakeClock(t3);
			const { limiter, state } = counter();
			limiter.activate();
			limiter.activate();
			limiter.cancel();
			limiter.activate();
			clock.advance(1000);
			t3.equal(state.count, 2, "activation after cancel runs");
		});
	});
});
