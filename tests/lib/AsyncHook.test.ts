import t from "tap";
import * as lib from "@clusterio/lib";

// Logger stand-in that records error messages
function recordingLogger() {
	const errors: string[] = [];
	const logger = { error: (message: string) => { errors.push(message); } } as unknown as lib.Logger;
	return { logger, errors };
}

t.test("AsyncHook", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("logs to the lib logger by default", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const hook = new lib.AsyncHook();
			hook.attach("alpha", () => { throw new Error("test"); });
			await hook.invoke();
			t3.equal(errors.calls.length, 1);
			t3.match(errors.calls[0].args[0], /^Ignoring error in hook "alpha":\nError: test/);
		});
		t2.test("times out handlers after 15 seconds by default", async t3 => {
			const timeouts: number[] = [];
			t3.capture(globalThis, "setTimeout", ((fn: () => void, ms: number) => {
				timeouts.push(ms);
				fn();
				return 0;
			}) as any);
			const { logger, errors } = recordingLogger();
			const hook = new lib.AsyncHook(logger);
			hook.attach("stuck", () => new Promise(() => {}));
			await hook.invoke();
			t3.strictSame(timeouts, [15_000]);
			t3.match(errors[0], "Hook stuck timed out after 15000ms");
		});
	});

	t1.test("size and attached", async t2 => {
		t2.test("track attached handlers in order", async t3 => {
			const hook = new lib.AsyncHook(recordingLogger().logger);
			t3.equal(hook.size, 0);
			t3.strictSame([...hook.attached], []);
			hook.attach("alpha", () => {});
			hook.attach("beta", () => {});
			t3.equal(hook.size, 2);
			t3.strictSame([...hook.attached], ["alpha", "beta"]);
		});
	});

	t1.test("attach()", async t2 => {
		t2.test("rejects duplicate handler names", async t3 => {
			const hook = new lib.AsyncHook(recordingLogger().logger);
			hook.attach("alpha", () => {});
			t3.throws(() => hook.attach("alpha", () => {}), new Error("Handler with name alpha is already attached"));
			t3.equal(hook.size, 1);
		});
		t2.test("accepts a name again after it was detached", async t3 => {
			const hook = new lib.AsyncHook<[], number>(recordingLogger().logger);
			hook.attach("alpha", () => 1);
			hook.detach("alpha");
			hook.attach("alpha", () => 2);
			t3.strictSame(await hook.collect(), [2]);
		});
	});

	t1.test("detach()", async t2 => {
		t2.test("removes the handler", async t3 => {
			const hook = new lib.AsyncHook(recordingLogger().logger);
			let called = false;
			hook.attach("alpha", () => { called = true; });
			hook.detach("alpha");
			await hook.invoke();
			t3.equal(called, false);
			t3.equal(hook.size, 0);
		});
		t2.test("does nothing for unknown names", async t3 => {
			const hook = new lib.AsyncHook(recordingLogger().logger);
			hook.attach("alpha", () => {});
			hook.detach("missing");
			t3.strictSame([...hook.attached], ["alpha"]);
		});
	});

	t1.test("clear()", async t2 => {
		t2.test("removes all handlers", async t3 => {
			const hook = new lib.AsyncHook(recordingLogger().logger);
			hook.attach("alpha", () => {});
			hook.attach("beta", () => {});
			hook.clear();
			t3.equal(hook.size, 0);
		});
	});

	t1.test("invoke()", async t2 => {
		t2.test("calls all handlers with the given arguments", async t3 => {
			const hook = new lib.AsyncHook<[number, string]>(recordingLogger().logger);
			const calls: unknown[] = [];
			hook.attach("alpha", (a, b) => { calls.push(["alpha", a, b]); });
			hook.attach("beta", async (a, b) => { calls.push(["beta", a, b]); });
			t3.equal(await hook.invoke(1, "two"), undefined);
			t3.strictSame(calls, [["alpha", 1, "two"], ["beta", 1, "two"]]);
		});
		t2.test("resolves with no handlers", async t3 => {
			const hook = new lib.AsyncHook(recordingLogger().logger);
			t3.equal(await hook.invoke(), undefined);
		});
		t2.test("runs handlers concurrently", async t3 => {
			const hook = new lib.AsyncHook(recordingLogger().logger);
			const events: string[] = [];
			let release!: () => void;
			const gate = new Promise<void>(resolve => { release = resolve; });
			hook.attach("slow", async () => { events.push("slow start"); await gate; events.push("slow end"); });
			hook.attach("fast", () => { events.push("fast"); release(); });
			await hook.invoke();
			t3.strictSame(events, ["slow start", "fast", "slow end"]);
		});
		t2.test("logs and ignores errors from handlers", async t3 => {
			const { logger, errors } = recordingLogger();
			const hook = new lib.AsyncHook(logger);
			let betaCalled = false;
			hook.attach("alpha", () => { throw new Error("sync"); });
			hook.attach("beta", async () => { betaCalled = true; });
			hook.attach("gamma", async () => { throw new Error("async"); });
			await hook.invoke();
			t3.ok(betaCalled);
			t3.equal(errors.length, 2);
			t3.match(errors[0], /^Ignoring error in hook "alpha":\nError: sync\n {4}at /);
			t3.match(errors[1], /^Ignoring error in hook "gamma":\nError: async\n {4}at /);
		});
		t2.test("logs thrown values that are not errors", async t3 => {
			const { logger, errors } = recordingLogger();
			const hook = new lib.AsyncHook(logger);
			hook.attach("string", () => { throw "plain"; }); // eslint-disable-line no-throw-literal
			// Testing a non-Error rejection
			// eslint-disable-next-line prefer-promise-reject-errors
			hook.attach("undefined", () => Promise.reject(undefined));
			await hook.invoke();
			t3.strictSame(errors, [
				'Ignoring error in hook "string":\nplain',
				'Ignoring error in hook "undefined":\nundefined',
			]);
		});
		t2.test("times out handlers that never settle", async t3 => {
			const { logger, errors } = recordingLogger();
			const hook = new lib.AsyncHook(logger, 5);
			hook.attach("stuck", () => new Promise(() => {}));
			await hook.invoke();
			t3.equal(errors.length, 1);
			t3.match(errors[0], /^Ignoring error in hook "stuck":\nError: Hook stuck timed out after 5ms/);
		});
	});

	t1.test("listener", async t2 => {
		t2.test("is stable and bound to the hook", async t3 => {
			const hook = new lib.AsyncHook<[string]>(recordingLogger().logger);
			const calls: string[] = [];
			hook.attach("alpha", arg => { calls.push(arg); });
			const { listener } = hook;
			t3.equal(listener, hook.listener);
			await listener("value");
			t3.strictSame(calls, ["value"]);
		});
	});

	t1.test("collect()", async t2 => {
		t2.test("returns results that are not undefined", async t3 => {
			const hook = new lib.AsyncHook<[number], number | null | void>(recordingLogger().logger);
			hook.attach("alpha", arg => arg);
			hook.attach("beta", () => undefined);
			hook.attach("gamma", async arg => arg * 2);
			hook.attach("delta", () => { throw new Error("Test"); });
			hook.attach("epsilon", () => null);
			hook.attach("zeta", () => 0);
			t3.strictSame(await hook.collect(21), [21, 42, null, 0]);
		});
		t2.test("leaves out timed out handlers", async t3 => {
			const hook = new lib.AsyncHook<[], number>(recordingLogger().logger, 5);
			hook.attach("stuck", () => new Promise(() => {}));
			hook.attach("fast", () => 1);
			t3.strictSame(await hook.collect(), [1]);
		});
		t2.test("returns an empty list with no handlers", async t3 => {
			const hook = new lib.AsyncHook<[], number>(recordingLogger().logger);
			t3.strictSame(await hook.collect(), []);
		});
	});

	t1.test("collectEntries()", async t2 => {
		t2.test("returns results with the name of their handler", async t3 => {
			const hook = new lib.AsyncHook<[number], number | void>(recordingLogger().logger);
			hook.attach("alpha", arg => arg);
			hook.attach("beta", () => undefined);
			hook.attach("gamma", async arg => arg * 2);
			hook.attach("delta", () => { throw new Error("Test"); });
			t3.strictSame(await hook.collectEntries(21), [["alpha", 21], ["gamma", 42]]);
		});
	});
});

t.test("AsyncHookCollection", async t1 => {
	class TestHooks extends lib.AsyncHookCollection {
		first = this.newHook<[], number>();
		second = this.newHook();
		custom: lib.AsyncHook<[]>;
		constructor(logger?: lib.Logger, customLogger?: lib.Logger) {
			super(logger);
			this.custom = this.newHook(customLogger);
		}
	}

	t1.test("newHook()", async t2 => {
		t2.test("passes the collection logger to new hooks", async t3 => {
			const { logger, errors } = recordingLogger();
			const hooks = new TestHooks(logger);
			hooks.second.attach("alpha", () => { throw new Error("test"); });
			await hooks.second.invoke();
			t3.equal(errors.length, 1);
		});
		t2.test("accepts a logger for the hook", async t3 => {
			const collection = recordingLogger();
			const custom = recordingLogger();
			const hooks = new TestHooks(collection.logger, custom.logger);
			hooks.custom.attach("alpha", () => { throw new Error("test"); });
			await hooks.custom.invoke();
			t3.equal(collection.errors.length, 0);
			t3.equal(custom.errors.length, 1);
		});
		t2.test("uses the lib logger by default", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const hooks = new TestHooks();
			hooks.first.attach("alpha", () => { throw new Error("test"); });
			await hooks.first.invoke();
			t3.equal(errors.calls.length, 1);
		});
	});

	t1.test("size and attached", async t2 => {
		t2.test("count each name once across hooks", async t3 => {
			const hooks = new TestHooks(recordingLogger().logger);
			t3.equal(hooks.size, 0);
			hooks.first.attach("alpha", () => 1);
			hooks.second.attach("alpha", () => {});
			hooks.second.attach("beta", () => {});
			t3.equal(hooks.size, 2);
			t3.strictSame([...hooks.attached], ["alpha", "beta"]);
		});
	});

	t1.test("detachAll()", async t2 => {
		t2.test("detaches a name from every hook", async t3 => {
			const hooks = new TestHooks(recordingLogger().logger);
			hooks.first.attach("alpha", () => 1);
			hooks.second.attach("alpha", () => {});
			hooks.second.attach("beta", () => {});
			hooks.detachAll("alpha");
			t3.equal(hooks.first.size, 0);
			t3.strictSame([...hooks.second.attached], ["beta"]);
		});
	});

	t1.test("clearAll()", async t2 => {
		t2.test("clears every hook", async t3 => {
			const hooks = new TestHooks(recordingLogger().logger);
			hooks.first.attach("alpha", () => 1);
			hooks.second.attach("beta", () => {});
			hooks.clearAll();
			t3.equal(hooks.size, 0);
			t3.equal(hooks.first.size, 0);
			t3.equal(hooks.second.size, 0);
		});
	});
});
