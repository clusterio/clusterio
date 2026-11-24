import t from "tap";
import * as lib from "@clusterio/lib";

type Result = lib.CollectorResult;

async function collectAll(iterable: AsyncIterable<Result>) {
	const results: Result[] = [];
	for await (const result of iterable) {
		results.push(result);
	}
	return results;
}

// Known bugs, reported as todo until fixed
const staleChildTodo = "a cached child writes undefined + n, exporting NaN";
const backslashNTodo = "keyToLabels unescapes \\n before \\\\";
const emptyValueTodo = "keyToLabels regex needs one or more characters in a value";
const emptyAddLabelsTodo = "appends a trailing comma to the key";
const nonFiniteTodo = "JSON turns Infinity and NaN into null";

// Register collectors to a fresh registry and return its exposition
async function expose(...collectors: lib.Collector[]) {
	const registry = new lib.CollectorRegistry();
	for (const collector of collectors) {
		registry.register(collector);
	}
	return lib.exposition(registry.collect());
}

function labeledGauge() {
	return new lib.Gauge("test", "Help", { register: false, labels: ["a", "b"] });
}

// Stub process.hrtime.bigint so durations are exact
function fakeHrtime(t1: any, ...times: bigint[]) {
	const queue = [...times];
	return t1.capture(process.hrtime, "bigint", () => queue.shift());
}

// Every ASCII codepoint plus characters from the basic and supplementary planes
const specialLabel = `${Array.from({ length: 128 }, (_, i) => String.fromCodePoint(i)).join("")}©💣`;

t.test("Metric", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("stores type, name, help and labels", async t3 => {
			const metric = new lib.Metric("gauge", "a_b:c", "Help", ["x", "_y"]);
			t3.equal(metric.type, "gauge");
			t3.equal(metric.name, "a_b:c");
			t3.equal(metric.help, "Help");
			t3.strictSame(metric.labels, ["x", "_y"]);
		});
		t2.test("defaults to no labels", async t3 => {
			t3.strictSame(new lib.Metric("gauge", "a", "Help").labels, []);
		});
		t2.test("rejects a name that is not a string", async t3 => {
			t3.throws(() => new (lib.Metric as any)("gauge", 1, "Help"), new Error("Expected name to be a string"));
		});
		t2.test("rejects help that is not a string", async t3 => {
			t3.throws(() => new (lib.Metric as any)("gauge", "a"), new Error("Expected help to be a string"));
		});
		t2.test("rejects invalid names", async t3 => {
			for (const name of ["", " ", "0a", "$a", "a-b"]) {
				t3.throws(() => new lib.Metric("gauge", name, "Help"), new Error(`Invalid name '${name}'`));
			}
		});
		t2.test("rejects invalid label names", async t3 => {
			for (const label of ["", " ", "0a", "$a", "a:"]) {
				t3.throws(() => new lib.Metric("gauge", "a", "Help", [label]), new Error(`Invalid label '${label}'`));
			}
		});
		t2.test("rejects reserved label names", async t3 => {
			t3.throws(
				() => new lib.Metric("gauge", "a", "Help", ["x", "le"], ["le"]),
				new Error("Reserved label 'le'"),
			);
		});
	});
});

t.test("Collector", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("registers to the default registry by default", async t3 => {
			const collector = new lib.Collector();
			t3.teardown(() => lib.defaultRegistry.unregister(collector));
			t3.ok(lib.defaultRegistry.collectors.includes(collector));
		});
		t2.test("does not register when register is false", async t3 => {
			const collector = new lib.Collector(false);
			t3.notOk(lib.defaultRegistry.collectors.includes(collector));
		});
	});
	t1.test("collect()", async t2 => {
		t2.test("yields no results", async t3 => {
			t3.strictSame(await collectAll(new lib.Collector(false).collect()), []);
		});
	});
});

t.test("LabeledCollector", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("rejects unrecognized options", async t3 => {
			t3.throws(
				() => new lib.Gauge("test", "Help", { invalid: 1 } as any),
				new Error("Unrecognized option 'invalid'"),
			);
		});
		t2.test("does not register when the metric is invalid", async t3 => {
			const count = lib.defaultRegistry.collectors.length;
			t3.throws(() => new lib.Gauge("0", "Help"));
			t3.equal(lib.defaultRegistry.collectors.length, count);
		});
		t2.test("registers to the default registry by default", async t3 => {
			const gauge = new lib.Gauge("test", "Help");
			t3.teardown(() => lib.defaultRegistry.unregister(gauge));
			t3.ok(lib.defaultRegistry.collectors.includes(gauge));
		});
	});

	t1.test("labels()", async t2 => {
		t2.test("requires every label and no extras", async t3 => {
			const gauge = labeledGauge();
			t3.throws(() => gauge.labels({ a: "1" }), new Error("Missing label 'b'"));
			t3.throws(() => gauge.labels({ b: "1" }), new Error("Missing label 'a'"));
			t3.throws(() => gauge.labels({ a: "1", b: "2", c: "3" }), new Error("Extra label 'c'"));
			t3.throws(() => gauge.labels("1"), new Error("Missing label 'b'"));
			t3.throws(() => gauge.labels("1", "2", "3"), new Error("Extra positional label"));
		});
		t2.test("rejects label values that are not strings", async t3 => {
			const gauge = labeledGauge();
			const error = new Error("Expected value for label 'b' to be a string");
			t3.throws(() => gauge.labels({ a: "1", b: 2 } as any), error);
			t3.throws(() => gauge.labels("1", 2 as any), error);
		});
		t2.test("initialises a value for the label set", async t3 => {
			const gauge = labeledGauge();
			gauge.labels({ a: "1", b: "2" });
			gauge.labels("4", "5");
			t3.strictSame(gauge._values, new Map([['a="1",b="2"', 0], ['a="4",b="5"', 0]]));
		});
		t2.test("orders label object keys by the metric labels", async t3 => {
			const gauge = labeledGauge();
			gauge.labels({ b: "y", a: "x" });
			t3.strictSame([...gauge._values.keys()], ['a="x",b="y"']);
		});
		t2.test("returns the same child for the same labels", async t3 => {
			const gauge = labeledGauge();
			const child = gauge.labels("1", "2");
			t3.equal(gauge.labels("1", "2"), child);
			t3.equal(gauge.labels({ a: "1", b: "2" }), child);
			t3.not(gauge.labels("1", "3"), child);
		});
		t2.test("escapes backslash, quote and newline in values", async t3 => {
			const gauge = new lib.Gauge("test", "Help", { register: false, labels: ["a"] });
			gauge.labels('x\\y"z\nw');
			t3.strictSame([...gauge._values.keys()], ['a="x\\\\y\\"z\\nw"']);
		});
	});

	t1.test("remove()", async t2 => {
		t2.test("removes a label set and its value", async t3 => {
			const gauge = labeledGauge();
			const child = gauge.labels({ a: "1", b: "2" });
			gauge.labels("3", "4");
			t3.equal(gauge.remove({ a: "1", b: "2" }), 'a="1",b="2"');
			t3.strictSame([...gauge._values.keys()], ['a="3",b="4"']);
			t3.not(gauge.labels("1", "2"), child, "creates a new child afterwards");
		});
		t2.test("accepts positional labels", async t3 => {
			const gauge = labeledGauge();
			gauge.labels("1", "2");
			gauge.remove("1", "2");
			t3.equal(gauge._values.size, 0);
		});
		t2.test("rejects the empty label set", async t3 => {
			const gauge = new lib.Gauge("test", "Help", { register: false });
			t3.throws(() => gauge.remove({}), new Error("labels cannot be empty"));
			t3.equal(gauge.get(), 0, "default value is kept");
		});
		t2.test("does not re-export the series from a stale child", { todo: staleChildTodo }, async t3 => {
			const gauge = labeledGauge();
			const child = gauge.labels("1", "2");
			gauge.remove("1", "2");
			child.inc();
			t3.equal(gauge._values.size, 0);
		});
	});

	t1.test("removeAll()", async t2 => {
		t2.test("removes label sets matching a partial label set", async t3 => {
			const gauge = labeledGauge();
			gauge.labels("1", "2");
			gauge.labels("1", "3");
			gauge.labels("4", "6");
			gauge.removeAll({ a: "1" });
			t3.strictSame(gauge._values, new Map([['a="4",b="6"', 0]]));
		});
		t2.test("removes the children of matching label sets", async t3 => {
			const gauge = labeledGauge();
			const child = gauge.labels("1", "2");
			gauge.removeAll({ a: "1" });
			t3.not(gauge.labels("1", "2"), child);
		});
		t2.test("requires every given label to match", async t3 => {
			const gauge = labeledGauge();
			gauge.labels("1", "2");
			gauge.labels("1", "3");
			gauge.removeAll({ a: "1", b: "3" });
			t3.strictSame([...gauge._values.keys()], ['a="1",b="2"']);
		});
		t2.test("rejects the empty label set", async t3 => {
			const gauge = new lib.Gauge("test", "Help", { register: false });
			t3.throws(() => gauge.removeAll({}), new Error("labels cannot be empty"));
		});
		t2.test("matches values with special characters", async t3 => {
			const gauge = labeledGauge();
			gauge.labels(specialLabel, "2");
			gauge.removeAll({ a: specialLabel });
			t3.equal(gauge._values.size, 0);
			gauge.labels("1", specialLabel);
			gauge.removeAll({ a: "1" });
			t3.equal(gauge._values.size, 0);
		});
		t2.test("matches a literal backslash followed by n", { todo: backslashNTodo }, async t3 => {
			const gauge = labeledGauge();
			gauge.labels("\\n", "2");
			gauge.removeAll({ a: "\\n" });
			t3.equal(gauge._values.size, 0);
		});
		t2.test("handles empty label values", { todo: emptyValueTodo }, async t3 => {
			const gauge = labeledGauge();
			gauge.labels("", "2");
			t3.doesNotThrow(() => gauge.removeAll({ b: "2" }));
			t3.equal(gauge._values.size, 0);
		});
	});

	t1.test("clear()", async t2 => {
		t2.test("removes all label sets", async t3 => {
			const gauge = labeledGauge();
			const child = gauge.labels({ a: "1", b: "2" });
			gauge.labels({ a: "3", b: "4" });
			gauge.clear();
			t3.equal(gauge._values.size, 0);
			t3.not(gauge.labels("1", "2"), child);
		});
		t2.test("rejects an unlabeled metric", async t3 => {
			const gauge = new lib.Gauge("test", "Help", { register: false });
			t3.throws(() => gauge.clear(), new Error("Cannot clear unlabeled metric"));
		});
	});
});

t.test("ValueCollector", async t1 => {
	t1.test("get()", async t2 => {
		t2.test("returns the current value", async t3 => {
			const gauge = new lib.Gauge("test", "Help", { register: false });
			gauge.set(11);
			t3.equal(gauge.get(), 11);
		});
	});
	t1.test("collect()", async t2 => {
		t2.test("yields the metric and its values", async t3 => {
			const gauge = labeledGauge();
			gauge.labels("1", "2").set(3);
			const results = await collectAll(gauge.collect());
			t3.equal(results.length, 1);
			t3.equal(results[0].metric, gauge.metric);
			t3.strictSame(results[0].samples, new Map([["", new Map([['a="1",b="2"', 3]])]]));
		});
		t2.test("awaits the callback before yielding", async t3 => {
			const gauge = new lib.Gauge("test", "Help", {
				register: false,
				callback: async collector => {
					await new Promise(resolve => setImmediate(resolve));
					collector.set(5);
				},
			});
			const results = await collectAll(gauge.collect());
			t3.equal(results[0].samples.get("")!.get(""), 5);
		});
		t2.test("passes the collector to the callback", async t3 => {
			let received;
			const counter = new lib.Counter("test", "Help", {
				register: false,
				callback: collector => { received = collector; },
			});
			await collectAll(counter.collect());
			t3.equal(received, counter);
		});
	});
});

t.test("Counter", async t1 => {
	const counter = () => new lib.Counter("test", "Help", { register: false });

	t1.test("constructor", async t2 => {
		t2.test("initialises the value to 0", async t3 => {
			t3.equal(counter().get(), 0);
		});
		t2.test("sets the metric type to counter", async t3 => {
			t3.equal(counter().metric.type, "counter");
		});
		t2.test("has no default value when labeled", async t3 => {
			const labeled = new lib.Counter("test", "Help", { register: false, labels: ["a"] });
			t3.equal(labeled._values.size, 0);
		});
	});

	t1.test("inc()", async t2 => {
		t2.test("increments by 1 by default", async t3 => {
			const c = counter();
			c.inc();
			c.inc();
			t3.equal(c.get(), 2);
		});
		t2.test("increments by the given value", async t3 => {
			const c = counter();
			c.inc(3.2);
			t3.equal(c.get(), 3.2);
		});
		t2.test("accepts 0 and Infinity", async t3 => {
			const c = counter();
			c.inc(0);
			t3.equal(c.get(), 0);
			c.inc(Infinity);
			t3.equal(c.get(), Infinity);
		});
		t2.test("rejects negative values and NaN", async t3 => {
			const c = counter();
			for (const value of [-1, -Infinity, NaN]) {
				t3.throws(() => c.inc(value), new Error("Expected value to be a positive number"));
			}
			t3.equal(c.get(), 0);
		});
		t2.test("increments a labeled child", async t3 => {
			const c = new lib.Counter("test", "Help", { register: false, labels: ["a"] });
			c.labels("x").inc(2);
			t3.equal(c.labels("x").get(), 2);
			t3.throws(() => c.labels("x").inc(-1));
		});
	});
});

t.test("Gauge", async t1 => {
	const gauge = () => new lib.Gauge("test", "Help", { register: false });
	const labeled = () => new lib.Gauge("test", "Help", { register: false, labels: ["a"] });

	t1.test("constructor", async t2 => {
		t2.test("initialises the value to 0", async t3 => {
			t3.equal(gauge().get(), 0);
		});
		t2.test("sets the metric type to gauge", async t3 => {
			t3.equal(gauge().metric.type, "gauge");
		});
	});

	t1.test("inc()", async t2 => {
		t2.test("increments by 1 by default", async t3 => {
			const g = gauge();
			g.inc();
			t3.equal(g.get(), 1);
		});
		t2.test("increments by the given value", async t3 => {
			const g = gauge();
			g.inc(3.2);
			t3.equal(g.get(), 3.2);
		});
		t2.test("decrements on a negative value", async t3 => {
			const g = gauge();
			g.inc(-2);
			t3.equal(g.get(), -2);
		});
		t2.test("increments a labeled child", async t3 => {
			const g = labeled();
			g.labels("x").inc();
			g.labels("x").inc(2);
			t3.equal(g.labels("x").get(), 3);
		});
	});

	t1.test("dec()", async t2 => {
		t2.test("decrements by 1 by default", async t3 => {
			const g = gauge();
			g.dec();
			t3.equal(g.get(), -1);
		});
		t2.test("decrements by the given value", async t3 => {
			const g = gauge();
			g.dec(3.2);
			t3.equal(g.get(), -3.2);
		});
		t2.test("increments on a negative value", async t3 => {
			const g = gauge();
			g.dec(-2);
			t3.equal(g.get(), 2);
		});
		t2.test("decrements a labeled child", async t3 => {
			const g = labeled();
			g.labels("x").dec();
			g.labels("x").dec(2);
			t3.equal(g.labels("x").get(), -3);
		});
	});

	t1.test("set()", async t2 => {
		t2.test("sets the value", async t3 => {
			const g = gauge();
			g.set(7);
			t3.equal(g.get(), 7);
		});
		t2.test("sets a labeled child", async t3 => {
			const g = labeled();
			g.labels("x").set(7);
			g.labels("y").set(8);
			t3.strictSame(g._values, new Map([['a="x"', 7], ['a="y"', 8]]));
		});
	});

	t1.test("setToCurrentTime()", async t2 => {
		t2.test("sets the value to the unix time in seconds", async t3 => {
			t3.capture(Date, "now", () => 1_700_000_123_456);
			const g = gauge();
			g.setToCurrentTime();
			t3.equal(g.get(), 1_700_000_123.456);
		});
		t2.test("sets a labeled child", async t3 => {
			t3.capture(Date, "now", () => 2000);
			const g = labeled();
			g.labels("x").setToCurrentTime();
			t3.equal(g.labels("x").get(), 2);
		});
	});

	t1.test("startTimer()", async t2 => {
		t2.test("sets the duration in seconds when the returned function is called", async t3 => {
			fakeHrtime(t3, 1_000_000_000n, 3_500_000_000n);
			const g = gauge();
			const setDuration = g.startTimer();
			t3.equal(g.get(), 0, "unchanged until called");
			setDuration();
			t3.equal(g.get(), 2.5);
		});
		t2.test("sets the duration on a labeled child", async t3 => {
			fakeHrtime(t3, 0n, 250_000_000n);
			const g = labeled();
			g.labels("x").startTimer()();
			t3.equal(g.labels("x").get(), 0.25);
		});
		t2.test("measures a real duration", async t3 => {
			const g = gauge();
			const setDuration = g.startTimer();
			setDuration();
			t3.ok(g.get() > 0 && g.get() < 1, `got ${g.get()}`);
		});
	});
});

t.test("Summary", async t1 => {
	const summary = () => new lib.Summary("test", "Help", { register: false });
	const labeled = () => new lib.Summary("test", "Help", { register: false, labels: ["a", "b"] });

	t1.test("constructor", async t2 => {
		t2.test("initialises sum and count to 0", async t3 => {
			const s = summary();
			t3.equal(s.sum, 0);
			t3.equal(s.count, 0);
			t3.equal(s.metric.type, "summary");
		});
		t2.test("rejects unrecognized options", async t3 => {
			t3.throws(
				() => new lib.Summary("test", "Help", { invalid: 1 } as any),
				new Error("Unrecognized option 'invalid'"),
			);
		});
		t2.test("has no default value when labeled", async t3 => {
			const s = labeled();
			t3.equal(s._sumValues.size, 0);
			t3.equal(s._countValues.size, 0);
		});
	});

	t1.test("observe()", async t2 => {
		t2.test("adds to sum and count", async t3 => {
			const s = summary();
			s.observe(2);
			t3.equal(s.sum, 2);
			t3.equal(s.count, 1);
			s.observe(4);
			t3.equal(s.sum, 6);
			t3.equal(s.count, 2);
		});
		t2.test("observes into a labeled child", async t3 => {
			const s = labeled();
			const child = s.labels("1", "2");
			child.observe(3);
			child.observe(4);
			t3.equal(child.sum, 7);
			t3.equal(child.count, 2);
			t3.equal(s.labels({ a: "1", b: "2" }), child);
		});
	});

	t1.test("startTimer()", async t2 => {
		t2.test("observes the duration each time the returned function is called", async t3 => {
			fakeHrtime(t3, 0n, 1_000_000_000n, 3_000_000_000n);
			const s = summary();
			const observe = s.startTimer();
			t3.equal(s.count, 0);
			observe();
			observe();
			t3.equal(s.count, 2);
			t3.equal(s.sum, 4);
		});
		t2.test("observes into a labeled child", async t3 => {
			fakeHrtime(t3, 0n, 500_000_000n);
			const s = labeled();
			s.labels("1", "2").startTimer()();
			t3.equal(s.labels("1", "2").sum, 0.5);
			t3.equal(s.labels("1", "2").count, 1);
		});
	});

	t1.test("labels()", async t2 => {
		t2.test("initialises sum and count for the label set", async t3 => {
			const s = labeled();
			s.labels({ a: "1", b: "2" });
			s.labels("4", "5");
			const expected = new Map([['a="1",b="2"', 0], ['a="4",b="5"', 0]]);
			t3.strictSame(s._sumValues, expected);
			t3.strictSame(s._countValues, expected);
		});
	});

	t1.test("collect()", async t2 => {
		t2.test("yields _sum and _count samples after the callback", async t3 => {
			const s = new lib.Summary("test", "Help", {
				register: false,
				callback: collector => { collector.observe(3); },
			});
			const [result] = await collectAll(s.collect());
			t3.equal(result.metric, s.metric);
			t3.strictSame(result.samples, new Map([
				["_sum", new Map([["", 3]])],
				["_count", new Map([["", 1]])],
			]));
		});
	});

	t1.test("remove()", async t2 => {
		t2.test("removes sum and count for the label set", async t3 => {
			const s = labeled();
			s.labels("1", "2");
			s.labels("3", "4");
			t3.equal(s.remove("1", "2"), 'a="1",b="2"');
			t3.strictSame([...s._sumValues.keys()], ['a="3",b="4"']);
			t3.strictSame([...s._countValues.keys()], ['a="3",b="4"']);
		});
	});

	t1.test("removeAll()", async t2 => {
		t2.test("removes label sets matching a partial label set", async t3 => {
			const s = labeled();
			s.labels("1", "2");
			s.labels("1", "3");
			s.labels("4", "6");
			s.removeAll({ a: "1" });
			t3.strictSame(s._sumValues, new Map([['a="4",b="6"', 0]]));
			t3.strictSame(s._countValues, new Map([['a="4",b="6"', 0]]));
		});
	});

	t1.test("clear()", async t2 => {
		t2.test("removes all label sets", async t3 => {
			const s = labeled();
			s.labels("1", "2");
			s.labels("4", "6");
			s.clear();
			t3.equal(s._sumValues.size, 0);
			t3.equal(s._countValues.size, 0);
		});
		t2.test("rejects an unlabeled summary", async t3 => {
			t3.throws(() => summary().clear(), new Error("Cannot clear unlabeled metric"));
		});
	});
});

t.test("Histogram", async t1 => {
	const histogram = () => new lib.Histogram("test", "Help", { register: false, buckets: [1, 2, 3, 4, Infinity] });
	const labeled = () => new lib.Histogram(
		"test", "Help", { register: false, buckets: [1, Infinity], labels: ["a", "b"] },
	);

	t1.test("constructor", async t2 => {
		t2.test("initialises buckets, sum and count to 0", async t3 => {
			const h = histogram();
			t3.strictSame(h.buckets, new Map([[1, 0], [2, 0], [3, 0], [4, 0], [Infinity, 0]]));
			t3.equal(h.sum, 0);
			t3.equal(h.count, 0);
			t3.equal(h.metric.type, "histogram");
		});
		t2.test("uses the Python client buckets by default", async t3 => {
			const h = new lib.Histogram("test", "Help", { register: false });
			t3.strictSame(
				h._buckets,
				[0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10, Infinity],
			);
		});
		t2.test("appends an Infinity bucket if missing", async t3 => {
			t3.strictSame(new lib.Histogram("test", "Help", { register: false, buckets: [1] })._buckets, [1, Infinity]);
			t3.strictSame(new lib.Histogram("test", "Help", { register: false, buckets: [] })._buckets, [Infinity]);
		});
		t2.test("does not mutate the buckets option", async t3 => {
			const buckets = [1];
			void new lib.Histogram("test", "Help", { register: false, buckets });
			t3.strictSame(buckets, [1]);
		});
		t2.test("rejects unrecognized options", async t3 => {
			t3.throws(
				() => new lib.Histogram("test", "Help", { invalid: 1 } as any),
				new Error("Unrecognized option 'invalid'"),
			);
		});
		t2.test("rejects le as a label", async t3 => {
			t3.throws(
				() => new lib.Histogram("test", "Help", { register: false, labels: ["le", "test"] }),
				new Error("Reserved label 'le'"),
			);
		});
	});

	t1.test("observe()", async t2 => {
		t2.test("increments every bucket with a bound at or above the value", async t3 => {
			const h = histogram();
			h.observe(2);
			t3.strictSame(h.buckets, new Map([[1, 0], [2, 1], [3, 1], [4, 1], [Infinity, 1]]));
			t3.equal(h.sum, 2);
			t3.equal(h.count, 1);
			h.observe(4);
			t3.strictSame(h.buckets, new Map([[1, 0], [2, 1], [3, 1], [4, 2], [Infinity, 2]]));
			t3.equal(h.sum, 6);
			t3.equal(h.count, 2);
		});
		t2.test("counts values above every finite bound in +Inf only", async t3 => {
			const h = histogram();
			h.observe(100);
			t3.strictSame(h.buckets, new Map([[1, 0], [2, 0], [3, 0], [4, 0], [Infinity, 1]]));
		});
		t2.test("observes into a labeled child", async t3 => {
			const h = labeled();
			const child = h.labels("1", "2");
			child.observe(0.5);
			child.observe(2);
			t3.strictSame(child.buckets, new Map([[1, 1], [Infinity, 2]]));
			t3.equal(child.sum, 2.5);
			t3.equal(child.count, 2);
		});
	});

	t1.test("startTimer()", async t2 => {
		t2.test("observes the duration each time the returned function is called", async t3 => {
			fakeHrtime(t3, 0n, 1_500_000_000n, 2_500_000_000n);
			const h = histogram();
			const observe = h.startTimer();
			t3.equal(h.count, 0);
			observe();
			observe();
			t3.equal(h.count, 2);
			t3.equal(h.sum, 4);
			t3.strictSame(h.buckets, new Map([[1, 0], [2, 1], [3, 2], [4, 2], [Infinity, 2]]));
		});
		t2.test("observes into a labeled child", async t3 => {
			fakeHrtime(t3, 0n, 500_000_000n);
			const h = labeled();
			h.labels("1", "2").startTimer()();
			t3.strictSame(h.labels("1", "2").buckets, new Map([[1, 1], [Infinity, 1]]));
		});
	});

	t1.test("linear()", async t2 => {
		t2.test("returns count buckets spaced by width", async t3 => {
			t3.strictSame(lib.Histogram.linear(1, 2, 3), [1, 3, 5]);
			t3.strictSame(lib.Histogram.linear(-1, 4, 3), [-1, 3, 7]);
			t3.strictSame(lib.Histogram.linear(1, 1, 4), [1, 2, 3, 4]);
			t3.strictSame(lib.Histogram.linear(1, 1, 0), []);
		});
	});

	t1.test("exponential()", async t2 => {
		t2.test("returns count buckets multiplied by factor", async t3 => {
			t3.strictSame(lib.Histogram.exponential(1, 2, 3), [1, 2, 4]);
			t3.strictSame(lib.Histogram.exponential(2, 10, 3), [2, 20, 200]);
			t3.strictSame(lib.Histogram.exponential(1, 1.5, 4), [1, 1.5, 2.25, 3.375]);
			t3.strictSame(lib.Histogram.exponential(1, 2, 0), []);
		});
	});

	t1.test("labels()", async t2 => {
		t2.test("initialises buckets, sum and count for the label set", async t3 => {
			const h = labeled();
			h.labels({ a: "1", b: "2" });
			t3.strictSame(h._bucketValues, new Map([['a="1",b="2",le="1"', 0], ['a="1",b="2",le="+Inf"', 0]]));
			t3.strictSame(h._sumValues, new Map([['a="1",b="2"', 0]]));
			t3.strictSame(h._countValues, new Map([['a="1",b="2"', 0]]));
		});
		t2.test("returns the same child for the same labels", async t3 => {
			const h = labeled();
			const child = h.labels("1", "2");
			t3.equal(h.labels({ a: "1", b: "2" }), child);
		});
	});

	t1.test("collect()", async t2 => {
		t2.test("yields _bucket, _sum and _count samples after the callback", async t3 => {
			const h = new lib.Histogram("test", "Help", {
				register: false,
				buckets: [1],
				callback: collector => { collector.observe(0.5); },
			});
			const [result] = await collectAll(h.collect());
			t3.strictSame(result.samples, new Map([
				["_bucket", new Map([['le="1"', 1], ['le="+Inf"', 1]])],
				["_sum", new Map([["", 0.5]])],
				["_count", new Map([["", 1]])],
			]));
		});
	});

	t1.test("remove()", async t2 => {
		t2.test("removes buckets, sum and count for the label set", async t3 => {
			const h = labeled();
			h.labels("1", "2");
			h.labels("3", "4");
			t3.equal(h.remove("1", "2"), 'a="1",b="2"');
			t3.strictSame([...h._bucketValues.keys()], ['a="3",b="4",le="1"', 'a="3",b="4",le="+Inf"']);
			t3.strictSame([...h._sumValues.keys()], ['a="3",b="4"']);
			t3.strictSame([...h._countValues.keys()], ['a="3",b="4"']);
		});
	});

	t1.test("removeAll()", async t2 => {
		t2.test("removes label sets matching a partial label set", async t3 => {
			const h = labeled();
			h.labels("1", "2");
			h.labels("1", "3");
			h.labels("4", "6");
			h.removeAll({ a: "1" });
			t3.strictSame(h._bucketValues, new Map([['a="4",b="6",le="1"', 0], ['a="4",b="6",le="+Inf"', 0]]));
			t3.strictSame(h._sumValues, new Map([['a="4",b="6"', 0]]));
			t3.strictSame(h._countValues, new Map([['a="4",b="6"', 0]]));
		});
	});

	t1.test("clear()", async t2 => {
		t2.test("removes all label sets", async t3 => {
			const h = labeled();
			h.labels("1", "2");
			h.labels("4", "6");
			h.clear();
			t3.equal(h._bucketValues.size, 0);
			t3.equal(h._sumValues.size, 0);
			t3.equal(h._countValues.size, 0);
		});
	});
});

t.test("CollectorRegistry", async t1 => {
	t1.test("register()", async t2 => {
		t2.test("adds the collector", async t3 => {
			const registry = new lib.CollectorRegistry();
			const collector = new lib.Collector(false);
			registry.register(collector);
			t3.strictSame(registry.collectors, [collector]);
		});
		t2.test("rejects a collector that is already registered", async t3 => {
			const registry = new lib.CollectorRegistry();
			const collector = new lib.Collector(false);
			registry.register(collector);
			t3.throws(
				() => registry.register(collector),
				new Error("Collector is already registered in this registry."),
			);
		});
		t2.test("allows the same collector in several registries", async t3 => {
			const first = new lib.CollectorRegistry();
			const second = new lib.CollectorRegistry();
			const collector = new lib.Collector(false);
			first.register(collector);
			second.register(collector);
			t3.ok(first.collectors.includes(collector));
			t3.ok(second.collectors.includes(collector));
		});
	});

	t1.test("unregister()", async t2 => {
		t2.test("removes the collector", async t3 => {
			const registry = new lib.CollectorRegistry();
			const kept = new lib.Collector(false);
			const removed = new lib.Collector(false);
			registry.register(kept);
			registry.register(removed);
			registry.unregister(removed);
			t3.strictSame(registry.collectors, [kept]);
		});
		t2.test("rejects a collector that is not registered", async t3 => {
			const registry = new lib.CollectorRegistry();
			t3.throws(
				() => registry.unregister(new lib.Collector(false)),
				new Error("Collector is not registered in this registry."),
			);
		});
	});

	t1.test("collect()", async t2 => {
		t2.test("yields results from every collector in order", async t3 => {
			const registry = new lib.CollectorRegistry();
			const a = new lib.Counter("a", "Help", { register: false });
			const b = new lib.Gauge("b", "Help", { register: false });
			registry.register(a);
			registry.register(new lib.Collector(false));
			registry.register(b);
			const results = await collectAll(registry.collect());
			t3.strictSame(results.map(r => r.metric), [a.metric, b.metric]);
		});
	});
});

t.test("defaultRegistry", async t1 => {
	t1.test("contains the default collectors", async t2 => {
		for (const [name, collector] of Object.entries(lib.defaultCollectors)) {
			t2.ok(lib.defaultRegistry.collectors.includes(collector), `${name} is registered`);
		}
	});
});

t.test("defaultCollectors", async t1 => {
	async function value(collector: lib.Gauge) {
		const [result] = await collectAll(collector.collect());
		return result.samples.get("")!.get("");
	}

	t1.test("processCpuSecondsTotal", async t2 => {
		t2.test("sums user and system CPU time in seconds", async t3 => {
			t3.capture(process, "cpuUsage", () => ({ user: 1_500_000, system: 500_000 }));
			t3.equal(await value(lib.defaultCollectors.processCpuSecondsTotal), 2);
		});
	});
	t1.test("processResidentMemoryBytes", async t2 => {
		t2.test("reports the resident set size", async t3 => {
			t3.capture(process, "memoryUsage", () => ({ rss: 1234, heapUsed: 56 }) as any);
			t3.equal(await value(lib.defaultCollectors.processResidentMemoryBytes), 1234);
		});
	});
	t1.test("processHeapBytes", async t2 => {
		t2.test("reports the heap used", async t3 => {
			t3.capture(process, "memoryUsage", () => ({ rss: 1234, heapUsed: 56 }) as any);
			t3.equal(await value(lib.defaultCollectors.processHeapBytes), 56);
		});
	});
	t1.test("processStartTimeSeconds", async t2 => {
		t2.test("is the time the module loaded", async t3 => {
			const start = await value(lib.defaultCollectors.processStartTimeSeconds);
			const now = Date.now() / 1000;
			t3.ok(start! <= now && start! > now - 60, `got ${start}, now ${now}`);
		});
	});
});

t.test("exposition()", async t1 => {
	t1.test("formats unlabeled metrics separated by a blank line", async t2 => {
		const exposition = await expose(
			new lib.Counter("a", "Help", { register: false }),
			new lib.Gauge("b", "Help", { register: false }),
		);
		t2.equal(exposition,
			"# HELP a Help\n" +
			"# TYPE a counter\n" +
			"a 0\n" +
			"\n" +
			"# HELP b Help\n" +
			"# TYPE b gauge\n" +
			"b 0\n",
		);
	});
	t1.test("formats labeled metrics", async t2 => {
		const gauge = labeledGauge();
		gauge.labels({ a: "1", b: "2" });
		gauge.labels({ b: "y", a: "x" }).set(3);
		t2.equal(await expose(gauge),
			"# HELP test Help\n" +
			"# TYPE test gauge\n" +
			'test{a="1",b="2"} 0\n' +
			'test{a="x",b="y"} 3\n',
		);
	});
	t1.test("formats histograms", async t2 => {
		const histogram = new lib.Histogram("test", "Help", { register: false, buckets: [1, 2, 3, 4] });
		for (const value of [2, 2, 5, 2]) {
			histogram.observe(value);
		}
		t2.equal(await expose(histogram),
			"# HELP test Help\n" +
			"# TYPE test histogram\n" +
			'test_bucket{le="1"} 0\n' +
			'test_bucket{le="2"} 3\n' +
			'test_bucket{le="3"} 3\n' +
			'test_bucket{le="4"} 3\n' +
			'test_bucket{le="+Inf"} 4\n' +
			"test_sum 11\n" +
			"test_count 4\n",
		);
	});
	t1.test("formats labeled histograms", async t2 => {
		const histogram = new lib.Histogram("test", "Help", { register: false, buckets: [1], labels: ["l"] });
		for (const [value, label] of [[1, "a"], [2, "b"], [3, "b"]] as const) {
			histogram.labels(label).observe(value);
		}
		histogram.labels("c");
		t2.equal(await expose(histogram),
			"# HELP test Help\n" +
			"# TYPE test histogram\n" +
			'test_bucket{l="a",le="1"} 1\n' +
			'test_bucket{l="a",le="+Inf"} 1\n' +
			'test_bucket{l="b",le="1"} 0\n' +
			'test_bucket{l="b",le="+Inf"} 2\n' +
			'test_bucket{l="c",le="1"} 0\n' +
			'test_bucket{l="c",le="+Inf"} 0\n' +
			'test_sum{l="a"} 1\n' +
			'test_sum{l="b"} 5\n' +
			'test_sum{l="c"} 0\n' +
			'test_count{l="a"} 1\n' +
			'test_count{l="b"} 2\n' +
			'test_count{l="c"} 0\n',
		);
	});
	t1.test("formats summaries", async t2 => {
		const summary = new lib.Summary("test", "Help", { register: false });
		summary.observe(1.5);
		t2.equal(await expose(summary),
			"# HELP test Help\n" +
			"# TYPE test summary\n" +
			"test_sum 1.5\n" +
			"test_count 1\n",
		);
	});
	t1.test("formats Infinity and NaN", async t2 => {
		const gauge = new lib.Gauge("test", "Help", { register: false, labels: ["n"] });
		gauge.labels({ n: "1" }).set(Infinity);
		gauge.labels({ n: "2" }).set(-Infinity);
		gauge.labels({ n: "3" }).set(NaN);
		t2.equal(await expose(gauge),
			"# HELP test Help\n" +
			"# TYPE test gauge\n" +
			'test{n="1"} +Inf\n' +
			'test{n="2"} -Inf\n' +
			'test{n="3"} NaN\n',
		);
	});
	t1.test("escapes help text and label values", async t2 => {
		const gauge = new lib.Gauge("test", 'a\\b\nc "d"', { register: false, labels: ["l"] });
		gauge.labels('x\\y"z\nw');
		t2.equal(await expose(gauge),
			'# HELP test a\\\\b\\nc "d"\n' +
			"# TYPE test gauge\n" +
			'test{l="x\\\\y\\"z\\nw"} 0\n',
		);
	});
	t1.test("formats nothing for no results", async t2 => {
		t2.equal(await lib.exposition([]), "");
	});
	t1.test("accepts a synchronous iterable of results", async t2 => {
		const counter = new lib.Counter("a", "Help", { register: false });
		const results = await collectAll(counter.collect());
		t2.equal(await lib.exposition(results), "# HELP a Help\n# TYPE a counter\na 0\n");
	});
	t1.test("collects the default registry by default", async t2 => {
		const gauge = new lib.Gauge("exposition_default_test", "Help");
		t2.teardown(() => lib.defaultRegistry.unregister(gauge));
		const text = await lib.exposition();
		t2.match(text, /^# TYPE process_cpu_seconds_total gauge$/m);
		t2.match(text, /^exposition_default_test 0$/m);
	});
});

t.test("expositionContentType", async t1 => {
	t1.equal(lib.expositionContentType, "text/plain; version=0.0.4");
});

t.test("serializeResult()", async t1 => {
	const validate = lib.compile(lib.CollectorResultSerialized as any);
	const result = (labels: string[] = [], samples: [string, [string, number][]][] = [["", [["", 2]]]]): Result => ({
		metric: new lib.Metric("gauge", "name", "Help", labels),
		samples: new Map(samples.map(([suffix, values]) => [suffix, new Map(values)])),
	});

	t1.test("converts collected results into plain objects", async t2 => {
		const registry = new lib.CollectorRegistry();
		const counter = new lib.Counter("a_counter", "Counter", { register: false });
		const gauge = new lib.Gauge("a_gauge", "Gauge", { register: false, labels: ["a", "b"] });
		registry.register(counter);
		registry.register(gauge);
		counter.inc(3);
		gauge.labels("1", "2").set(1);
		gauge.labels("3", "4").set(5);

		const serialized = (await collectAll(registry.collect())).map(r => lib.serializeResult(r));
		t2.strictSame(serialized, [
			{
				metric: { type: "counter", name: "a_counter", help: "Counter", labels: [] },
				samples: [["", [["", 3]]]],
			},
			{
				metric: { type: "gauge", name: "a_gauge", help: "Gauge", labels: ["a", "b"] },
				samples: [["", [['a="1",b="2"', 1], ['a="3",b="4"', 5]]]],
			},
		]);
		for (const item of serialized) {
			t2.ok(validate(item), "matches CollectorResultSerialized", { errors: validate.errors });
		}
	});
	t1.test("adds labels to unlabeled and labeled samples", async t2 => {
		t2.strictSame(lib.serializeResult(result([], [["_sum", [["", 2]]]]), { addLabels: { c: "8" } }), {
			metric: { type: "gauge", name: "name", help: "Help", labels: ["c"] },
			samples: [["_sum", [['c="8"', 2]]]],
		});
		t2.strictSame(lib.serializeResult(result(["a"], [["", [['a="4"', 3]]]]), { addLabels: { c: "8", d: '"' } }), {
			metric: { type: "gauge", name: "name", help: "Help", labels: ["a", "c", "d"] },
			samples: [["", [['a="4",c="8",d="\\""', 3]]]],
		});
	});
	t1.test("does not modify the result when adding labels", async t2 => {
		const original = result(["a"], [["", [['a="4"', 3]]]]);
		lib.serializeResult(original, { addLabels: { c: "8" } });
		t2.strictSame(original.samples, new Map([["", new Map([['a="4"', 3]])]]));
		t2.strictSame(original.metric.labels, ["a"]);
	});
	t1.test("leaves labeled samples unchanged for an empty addLabels", { todo: emptyAddLabelsTodo }, async t2 => {
		t2.strictSame(lib.serializeResult(result(["a"], [["", [['a="4"', 3]]]]), { addLabels: {} }).samples, [
			["", [['a="4"', 3]]],
		]);
	});
	t1.test("overrides name and help", async t2 => {
		t2.strictSame(lib.serializeResult(result(), { metricName: "new" }).metric.name, "new");
		t2.strictSame(lib.serializeResult(result(), { metricHelp: "other" }).metric.help, "other");
	});
	t1.test("rejects unrecognized options", async t2 => {
		t2.throws(
			() => lib.serializeResult(result(), { invalid: true } as any),
			new Error("Unrecognized option 'invalid'"),
		);
	});
});

t.test("deserializeResult()", async t1 => {
	t1.test("converts a plain object into a result", async t2 => {
		const deserialized = lib.deserializeResult({
			metric: { type: "gauge", name: "name", help: "Help", labels: ["a", "b"] },
			samples: [["", [['a="1",b="2"', 1], ['a="3",b="4"', 5]]]],
		});
		t2.ok(deserialized.metric instanceof lib.Metric);
		t2.strictSame(deserialized, {
			metric: new lib.Metric("gauge", "name", "Help", ["a", "b"]),
			samples: new Map([["", new Map([['a="1",b="2"', 1], ['a="3",b="4"', 5]])]]),
		});
	});
	t1.test("rejects an invalid metric name", async t2 => {
		t2.throws(() => lib.deserializeResult({
			metric: { type: "gauge", name: "0", help: "Help", labels: [] },
			samples: [],
		}), new Error("Invalid name '0'"));
	});
	t1.test("round trips results through JSON with the same exposition", async t2 => {
		const histogram = new lib.Histogram("test", "Help", { register: false, buckets: [1], labels: ["l"] });
		for (const [value, label] of [[1, "a"], [2, "b"], [3, 'b\n"\\']] as const) {
			histogram.labels(label).observe(value);
		}
		const summary = new lib.Summary("s", "Help\nline", { register: false });
		summary.observe(1.5);
		const registry = new lib.CollectorRegistry();
		registry.register(histogram);
		registry.register(summary);

		const results = await collectAll(registry.collect());
		const json = JSON.parse(JSON.stringify(results.map(r => lib.serializeResult(r))));
		const deserialized = json.map((r: any) => lib.deserializeResult(r));
		t2.strictSame(deserialized, results);
		t2.equal(await lib.exposition(deserialized), await lib.exposition(results));
	});
	t1.test("round trips non-finite values through JSON", { todo: nonFiniteTodo }, async t2 => {
		const gauge = new lib.Gauge("test", "Help", { register: false, labels: ["n"] });
		gauge.labels("1").set(Infinity);
		gauge.labels("2").set(NaN);
		const results = await collectAll(gauge.collect());
		const json = JSON.parse(JSON.stringify(results.map(r => lib.serializeResult(r))));
		t2.equal(await lib.exposition(json.map((r: any) => lib.deserializeResult(r))), await lib.exposition(results));
	});
});
