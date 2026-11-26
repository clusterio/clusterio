import t, { type Test } from "tap";
import * as lib from "@clusterio/lib";

// triple-beam keys winston uses for the level and formatted message
const LEVEL = Symbol.for("level");
const MESSAGE = Symbol.for("message");

function entry(level: string, message: string, fields: Record<string, unknown> = {}) {
	return { level, message, [LEVEL]: level, [MESSAGE]: message, ...fields };
}

// Log each entry through the transport and return the console calls it made
function logEntries(t1: Test, transport: lib.ConsoleTransport, entries: object[]) {
	const calls: [string, unknown][] = [];
	for (const method of ["error", "warn", "log"] as const) {
		t1.intercept(console, method, { value: (message: unknown) => { calls.push([method, message]); } });
	}
	const callbacks = { count: 0 };
	const callback = () => { callbacks.count += 1; };
	for (const info of entries) {
		transport.log(info, callback);
	}
	t1.equal(callbacks.count, entries.length, "calls back once per entry");
	return calls;
}

t.test("levels", async t1 => {
	t1.test("are ordered from fatal to verbose", async t2 => {
		t2.strictSame(Object.keys(lib.levels), [
			"fatal", "error", "warn", "audit", "info", "http", "server", "verbose",
		]);
		t2.strictSame(Object.values(lib.levels), [0, 1, 2, 3, 4, 5, 6, 7]);
		t2.ok(Object.isFrozen(lib.levels));
	});
});

t.test("ConsoleTransport", async t1 => {
	t1.test("log()", async t2 => {
		t2.test("writes errors, warnings and the rest to their console methods", async t3 => {
			const calls = logEntries(t3, new lib.ConsoleTransport(), [
				entry("fatal", "a"), entry("error", "b"), entry("warn", "c"), entry("info", "d"), entry("verbose", "e"),
			]);
			t3.strictSame(calls, [["error", "a"], ["error", "b"], ["warn", "c"], ["log", "d"], ["log", "e"]]);
		});
		t2.test("uses the configured error and warning levels", async t3 => {
			const transport = new lib.ConsoleTransport({ errorLevels: ["warn"], warnLevels: ["info"] });
			const calls = logEntries(t3, transport, [entry("error", "a"), entry("warn", "b"), entry("info", "c")]);
			t3.strictSame(calls, [["log", "a"], ["error", "b"], ["warn", "c"]]);
		});
		t2.test("logs everything to console.log with empty level lists", async t3 => {
			const transport = new lib.ConsoleTransport({ errorLevels: [], warnLevels: [] });
			const calls = logEntries(t3, transport, [entry("fatal", "a"), entry("warn", "b")]);
			t3.strictSame(calls, [["log", "a"], ["log", "b"]]);
		});
		t2.test("writes the formatted message", async t3 => {
			const info = { ...entry("info", "raw"), [MESSAGE]: "formatted" };
			const calls = logEntries(t3, new lib.ConsoleTransport(), [info]);
			t3.strictSame(calls, [["log", "formatted"]]);
		});
		t2.test("skips entries the filter rejects", async t3 => {
			const transport = new lib.ConsoleTransport({ filter: (info: any) => info.message !== "skip" });
			const calls = logEntries(t3, transport, [entry("info", "skip"), entry("error", "keep")]);
			t3.strictSame(calls, [["error", "keep"]]);
		});
	});
	t1.test("works as a winston transport", async t2 => {
		const calls: unknown[] = [];
		t2.intercept(console, "warn", { value: (message: unknown) => { calls.push(message); } });
		const transport = new lib.ConsoleTransport({ format: new lib.WebConsoleFormat() });
		lib.logger.add(transport);
		t2.teardown(() => { lib.logger.remove(transport); });
		lib.logger.warn("careful", { plugin: "test" });
		await new Promise(resolve => setImmediate(resolve));
		t2.strictSame(calls, ["[warn] test: careful"]);
	});
});

t.test("WebConsoleFormat", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("stores options", async t3 => {
			t3.strictSame(new lib.WebConsoleFormat().options, {});
			t3.strictSame(new lib.WebConsoleFormat({ a: 1 }).options, { a: 1 });
		});
	});
	t1.test("transform()", async t2 => {
		function format(fields: Record<string, unknown>) {
			const info: any = new lib.WebConsoleFormat().transform({ level: "info", message: "Hello", ...fields }, {});
			return info[MESSAGE];
		}
		t2.test("formats a plain message", async t3 => {
			t3.equal(format({}), "[info] Hello");
		});
		t2.test("prefixes the host", async t3 => {
			t3.equal(format({ host_id: 1, host_name: "alpha" }), "[info] h:alpha - Hello");
		});
		t2.test("prefixes the plugin", async t3 => {
			t3.equal(format({ plugin: "research_sync" }), "[info] research_sync: Hello");
		});
		t2.test("prefixes the instance", async t3 => {
			t3.equal(
				format({ instance_id: 2, instance_name: "beta" }),
				"[info] i:beta Hello",
			);
			t3.equal(
				format({ host_id: 1, host_name: "alpha", instance_id: 2, instance_name: "beta", plugin: "p" }),
				"[info] h:alpha - i:beta p: Hello",
			);
		});
		t2.test("uses the stack in place of the message", async t3 => {
			t3.equal(format({ stack: "Error: boom\n    at x" }), "[info] Error: boom\n    at x");
		});
		t2.test("returns the entry it was given", async t3 => {
			const info = { level: "info", message: "Hello" };
			t3.equal(new lib.WebConsoleFormat().transform(info, {}), info);
		});
	});
});

t.test("logFilter()", async t1 => {
	const controller = { level: "info" };
	const host = { level: "info", host_id: 1 };
	const instance = { level: "info", host_id: 1, instance_id: 10 };
	const all = [controller, host, instance];

	t1.test("matches nothing without options", async t2 => {
		t2.strictSame(all.map(lib.logFilter({})), [false, false, false]);
	});
	t1.test("matches everything with all", async t2 => {
		t2.strictSame(all.map(lib.logFilter({ all: true })), [true, true, true]);
	});
	t1.test("matches entries without a host with controller", async t2 => {
		t2.strictSame(all.map(lib.logFilter({ controller: true })), [true, false, false]);
	});
	t1.test("matches host entries by id but not their instances", async t2 => {
		t2.strictSame(all.map(lib.logFilter({ hostIds: [1] })), [false, true, false]);
		t2.strictSame(all.map(lib.logFilter({ hostIds: [2] })), [false, false, false]);
	});
	t1.test("matches instance entries by id", async t2 => {
		t2.strictSame(all.map(lib.logFilter({ instanceIds: [10] })), [false, false, true]);
		t2.strictSame(all.map(lib.logFilter({ instanceIds: [11] })), [false, false, false]);
	});
	t1.test("drops entries more verbose than maxLevel", async t2 => {
		const filter = lib.logFilter({ all: true, maxLevel: "warn" });
		t2.strictSame(
			["fatal", "error", "warn", "audit", "info"].map(level => filter({ level })),
			[true, true, true, false, false],
		);
	});
	t1.test("drops entries with unknown levels when maxLevel is set", async t2 => {
		t2.equal(lib.logFilter({ all: true, maxLevel: "verbose" })({ level: "debug" }), false);
		t2.equal(lib.logFilter({ all: true })({ level: "debug" }), true);
	});
	t1.test("accepts fatal as maxLevel", async t2 => {
		const filter = lib.logFilter({ all: true, maxLevel: "fatal" });
		t2.equal(filter({ level: "fatal" }), true);
		t2.equal(filter({ level: "error" }), false);
	});
});

t.test("logger", async t1 => {
	t1.test("has a method for each level", async t2 => {
		for (const level of Object.keys(lib.levels)) {
			t2.type((lib.logger as any)[level], "function", level);
		}
	});
});
