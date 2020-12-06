"use strict";
const assert = require("assert").strict;

const prometheus = require("@clusterio/lib/prometheus");


describe("lib/prometheus", function() {
	describe("class CollectorRegistry", function() {
		let registry;
		beforeEach(function() {
			registry = new prometheus.CollectorRegistry();
		});

		describe(".register()", function() {
			it("should register a collector", function() {
				let collector = new prometheus.Collector(false);
				registry.register(collector);
				assert(
					registry.collectors.includes(collector),
					"Collector was not registered"
				);
			});
			it("should throw when already registered", function() {
				let collector = new prometheus.Collector(false);
				registry.register(collector);
				assert.throws(
					() => registry.register(collector),
					new Error("Collector is already registered in this registry.")
				);
			});
			it("should allow being regitstered in another register", function() {
				let otherCollectorRegistry = new prometheus.CollectorRegistry();
				let collector = new prometheus.Collector(false);
				registry.register(collector);
				otherCollectorRegistry.register(collector);
				assert(
					registry.collectors.includes(collector),
					"Collector was not registered in first register"
				);
				assert(
					otherCollectorRegistry.collectors.includes(collector),
					"Collector was not registered in second register"
				);
			});
		});
		describe(".unregister()", function() {
			it("should removed a registered collector", function() {
				let collector = new prometheus.Collector(false);
				registry.register(collector);
				registry.unregister(collector);
				assert(
					!registry.collectors.includes(collector),
					"Collector was not removed"
				);
			});
			it("should throw when not registered", function() {
				let collector = new prometheus.Collector(false);
				assert.throws(
					() => registry.unregister(collector),
					new Error("Collector is not registered in this registry.")
				);
			});
		});

		describe("defaultRegistry", function() {
			it("should have collectors registered to it by default", function() {
				let collector = new prometheus.Collector();
				assert(
					prometheus.defaultRegistry.collectors.includes(collector),
					"collector was not registered to defaultRegistry"
				);
				prometheus.defaultRegistry.unregister(collector);
			});
			it("should have the default collectors registered to it", function() {
				let collectors = Object.entries(prometheus.defaultCollectors);
				for (let [name, collector] of collectors) {
					assert(
						prometheus.defaultRegistry.collectors.includes(collector),
						`${name} is not registered`
					);
				}
			});
			it("should allow default collectors to be unregistered", function() {
				this.skip(); // XXX Doesn't work in Clusterio's shared testing env
				let collectors = Object.values(prometheus.defaultCollectors);
				for (let collector of collectors) {
					prometheus.defaultRegistry.unregister(collector);
				}
				assert(
					prometheus.defaultRegistry.collectors.length === 0,
					"Collectors left over after removing the default ones"
				);
			});
		});
	});

	describe("class Collector", function() {
		it("should implement .collect()", async function() {
			let collector = new prometheus.Collector(false);
			for await (let result of collector.collect()) {
				assert.fail("Should not return any results");
			}
		});
	});

	describe("class Counter", function() {
		let counter;
		beforeEach(function() {
			counter = new prometheus.Counter("test", "Help", { register: false });
		});

		describe("constructor", function() {
			it("should be initialized to 0", function() {
				assert.equal(counter._values.get(""), 0);
			});
		});
		describe(".inc()", function() {
			it("should increment the counter by 1 by default", function() {
				counter.inc();
				assert.equal(counter._values.get(""), 1);
			});
			it("should increment the counter by specified value", function() {
				counter.inc(3.2);
				assert.equal(counter._values.get(""), 3.2);
			});
			it("should throw if value is negative", function() {
				assert.throws(
					() => counter.inc(-1),
					new Error("Expected value to be a positive number")
				);
			});
			it("should throw if value is negative infinity", function() {
				assert.throws(
					() => counter.inc(-Infinity),
					new Error("Expected value to be a positive number")
				);
			});
			it("should throw if value is NaN", function() {
				assert.throws(
					() => counter.inc(NaN),
					new Error("Expected value to be a positive number")
				);
			});
		});
	});

	describe("class Gauge", function() {
		let gauge;
		beforeEach(function() {
			gauge = new prometheus.Gauge("test", "Help", { register: false });
		});

		describe("constructor", function() {
			it("should be initialized to 0", function() {
				assert.equal(gauge._values.get(""), 0);
			});
		});
		describe(".inc()", function() {
			it("should increment the gauge by 1 by default", function() {
				gauge.inc();
				assert.equal(gauge._values.get(""), 1);
			});
			it("should increment the gauge by specified value", function() {
				gauge.inc(3.2);
				assert.equal(gauge._values.get(""), 3.2);
			});
			it("should decrement on negative value", function() {
				gauge.inc(-2);
				assert.equal(gauge._values.get(""), -2);
			});
		});
		describe(".dec()", function() {
			it("should decrement the gauge by 1 by default", function() {
				gauge.dec();
				assert.equal(gauge._values.get(""), -1);
			});
			it("should decrement the gauge by specified value", function() {
				gauge.dec(3.2);
				assert.equal(gauge._values.get(""), -3.2);
			});
			it("should increment on negative value", function() {
				gauge.dec(-2);
				assert.equal(gauge._values.get(""), 2);
			});
		});
		describe(".set()", function() {
			it("should set the gauge to the specified value", function() {
				gauge.set(7);
				assert.equal(gauge._values.get(""), 7);
			});
		});
		describe(".setToCurrentTime()", function() {
			it("should set the gauge to current unix time in seconds", function() {
				gauge.setToCurrentTime();
				assert(
					Math.abs(gauge._values.get("") - Date.now() / 1000) < 1,
					"value set is not close to the current unix time"
				);
			});
		});
		describe(".startTimer()", function() {
			it("should set the gauge to a short duration", function() {
				let setDuration = gauge.startTimer();
				setDuration();
				assert(
					gauge._values.get("") > 0 && gauge._values.get("") < 1,
					"value set is not between 0 and 1"
				);
			});
		});
	});

	describe("class Histogram", function() {
		let histogram;
		let labeledHistogram;
		beforeEach(function() {
			histogram = new prometheus.Histogram(
				"test", "Help", { register: false, buckets: [1, 2, 3, 4, Infinity] }
			);
			labeledHistogram = new prometheus.Histogram(
				"test", "Help", { register: false, buckets: [1, Infinity], labels: ["a", "b"] }
			);
		});

		describe("constructor", function() {
			it("should have buckets, sum and count initialized to 0", function() {
				assert.deepEqual(
					histogram.buckets,
					new Map([[1, 0], [2, 0], [3, 0], [4, 0], [Infinity, 0]])
				);
				assert.equal(histogram.sum, 0);
				assert.equal(histogram.count, 0);
			});
			it("should provide a default for buckets", function() {
				histogram = new prometheus.Histogram(
					"test", "help", { register: false }
				);
				assert(histogram._buckets.length, "no default buckets were made");
			});
			it("should add inifinity bucket if not present", function() {
				histogram = new prometheus.Histogram(
					"test", "help", { buckets: [1], register: false }
				);
				assert.deepEqual(histogram._buckets, [1, Infinity]);
			});
			it("should not mutate bucket option passed to it", function() {
				let buckets = [1];
				histogram = new prometheus.Histogram(
					"test", "help", { buckets, register: false }
				);
				assert.deepEqual(buckets, [1]);
			});
			it("should throw on unrecoginzed option", function() {
				assert.throws(
					() => new prometheus.Histogram("test", "help", { invalid: 1 }),
					new Error("Unrecognized option 'invalid'")
				);
			});
			it("should throw on using le as label", function() {
				assert.throws(() => {
					let test = new prometheus.Histogram(
						"test", "Help", { register: false, labels: ["le", "test"] }
					);
				}, new Error("Reserved label 'le'"));
			});
		});

		describe(".observe()", function() {
			it("should increment the appropriate bucket", function() {
				histogram.observe(2);
				assert.deepEqual(
					histogram.buckets,
					new Map([[1, 0], [2, 1], [3, 1], [4, 1], [Infinity, 1]])
				);
				assert.equal(histogram.sum, 2);
				assert.equal(histogram.count, 1);

				histogram.observe(4);
				assert.deepEqual(
					histogram.buckets,
					new Map([[1, 0], [2, 1], [3, 1], [4, 2], [Infinity, 2]])
				);
				assert.equal(histogram.sum, 6);
				assert.equal(histogram.count, 2);
			});
		});

		describe(".startTimer()", function() {
			it("should add observations when closure is called", function() {
				let observeDuration = histogram.startTimer();
				assert.equal(histogram.count, 0);
				observeDuration();
				assert.equal(histogram.count, 1);
				observeDuration();
				assert.equal(histogram.count, 2);
			});
		});

		describe("static .linear()", function() {
			it("should give back the appropriate buckets", function() {
				let linear = prometheus.Histogram.linear;
				assert.deepEqual(linear(1, 2, 3), [1, 3, 5]);
				assert.deepEqual(linear(-1, 4, 3), [-1, 3, 7]);
				assert.deepEqual(linear(1, 1, 4), [1, 2, 3, 4]);
			});
		});

		describe("static .exponential()", function() {
			it("should give back the appropriate buckets", function() {
				let exponential = prometheus.Histogram.exponential;
				assert.deepEqual(exponential(1, 2, 3), [1, 2, 4]);
				assert.deepEqual(exponential(2, 10, 3), [2, 20, 200]);
				assert.deepEqual(exponential(1, 1.5, 4), [1, 1.5, 2.25, 3.375]);
			});
		});

		describe(".labels()", function() {
			it("should initialize a value for the label set", function() {
				labeledHistogram.labels({ a: "1", b: "2" });
				assert(labeledHistogram._bucketValues.has('a="1",b="2",le="1"'), "bucket value not set");
				assert(labeledHistogram._bucketValues.has('a="1",b="2",le="+Inf"'), "bucket value not set");
				assert(labeledHistogram._sumValues.has('a="1",b="2"'), "sum value not set");
				assert(labeledHistogram._countValues.has('a="1",b="2"'), "count value not set");

				labeledHistogram.labels("4", "5");
				assert(labeledHistogram._bucketValues.has('a="4",b="5",le="1"'), "bucket value not set");
				assert(labeledHistogram._bucketValues.has('a="4",b="5",le="+Inf"'), "bucket value not set");
				assert(labeledHistogram._sumValues.has('a="4",b="5"'), "sum value not set");
				assert(labeledHistogram._countValues.has('a="4",b="5"'), "count value not set");
			});
			it("should return a child supporting the histogram methods", function() {
				let child = labeledHistogram.labels({ a: "1", b: "2" });
				void child.buckets;
				void child.sum;
				void child.count;
				child.observe(2);
				let observeDuration = child.startTimer();
				observeDuration();
				child = labeledHistogram.labels("7", "8");
				void child.buckets;
				void child.sum;
				void child.count;
				child.observe(2);
				observeDuration = child.startTimer();
				observeDuration();
			});
			it("should return the same child for the same labels", function() {
				let child = labeledHistogram.labels("1", "2");
				assert.equal(labeledHistogram.labels("1", "2"), child);
				assert.equal(labeledHistogram.labels({ a: "1", b: "2" }), child);
			});
		});
		describe(".remove()", function() {
			it("should remove a label set created with .labels()", function() {
				labeledHistogram.labels("1", "2");
				labeledHistogram.remove("1", "2");
				assert(!labeledHistogram._bucketValues.has('a="1",b="2",le="1"'), "bucket value not removed");
				assert(!labeledHistogram._bucketValues.has('a="1",b="2",le="+Inf"'), "bucket value not removed");
				assert(!labeledHistogram._sumValues.has('a="1",b="2"'), "sum value not removed");
				assert(!labeledHistogram._countValues.has('a="1",b="2"'), "count value not removed");
			});
		});
		describe(".removeAll()", function() {
			it("should remove a label set created with .labels()", function() {
				labeledHistogram.labels("1", "2");
				labeledHistogram.labels("1", "3");
				labeledHistogram.labels("4", "6");
				labeledHistogram.removeAll({ a: "1" });
				assert.deepEqual(
					labeledHistogram._bucketValues,
					new Map([['a="4",b="6",le="1"', 0], ['a="4",b="6",le="+Inf"', 0]])
				);
				assert.deepEqual(labeledHistogram._sumValues, new Map([['a="4",b="6"', 0]]));
				assert.deepEqual(labeledHistogram._countValues, new Map([['a="4",b="6"', 0]]));
			});
		});
		describe(".clear()", function() {
			it("should remove all label sets created with .labels()", function() {
				labeledHistogram.labels("1", "2");
				labeledHistogram.labels("1", "3");
				labeledHistogram.labels("4", "6");
				labeledHistogram.clear();
				assert(labeledHistogram._bucketValues.size === 0, "buckets were not cleared");
				assert(labeledHistogram._sumValues.size === 0, "sums were not cleared");
				assert(labeledHistogram._countValues.size === 0, "counts were not cleared");
			});
		});
	});

	describe("class ValueCollector", function() {
		describe(".get()", function() {
			it("should return the current value", function() {
				let gauge = new prometheus.Gauge("test", "Help", { register: false });
				gauge.set(11);
				assert.equal(gauge.get(), 11);
			});
		});
	});

	describe("class LabeledCollector", function() {
		describe("constructor", function() {
			it("should throw on invalid metric name", function() {
				for (let name of ["", " ", "0a", "$a"]) {
					assert.throws(
						() => new prometheus.Gauge(
							name, "Help", { register: false }
						),
						new Error(`Invalid name '${name}'`)
					);
				}
			});
			it("should throw on invalid label names", function() {
				for (let name of ["", " ", "0a", "$a", "a:"]) {
					assert.throws(
						() => new prometheus.Gauge(
							"test", "Help", { register: false, labels: [name] }
						),
						new Error(`Invalid label '${name}'`)
					);
				}
			});
			it("should throw on missing name", function() {
				assert.throws(
					() => new prometheus.Gauge(),
					new Error("Expected name to be a string")
				);
			});
			it("should throw on missing help", function() {
				assert.throws(
					() => new prometheus.Gauge("test"),
					new Error("Expected help to be a string")
				);
			});
			it("should throw on unrecoginzed option", function() {
				assert.throws(
					() => new prometheus.Gauge("test", "help", { invalid: 1 }),
					new Error("Unrecognized option 'invalid'")
				);
			});
		});

		describe(".labels()", function() {
			let gauge;
			beforeEach(function() {
				gauge = new prometheus.Gauge(
					"test", "Help", { register: false, labels: ["a", "b"] }
				);
			});
			it("should require all labels set at creation", function() {
				assert.throws(
					() => gauge.labels({ a: "1" }),
					new Error("Missing label 'b'")
				);
				assert.throws(
					() => gauge.labels({ b: "1" }),
					new Error("Missing label 'a'")
				);
				assert.throws(
					() => gauge.labels({ a: "1", b: "2", c: "3" }),
					new Error("Extra label 'c'")
				);
				assert.throws(
					() => gauge.labels("1"),
					new Error("Missing label 'b'")
				);
				assert.throws(
					() => gauge.labels("1", "2", "3"),
					new Error("Extra positional label")
				);
			});
			it("should throw if label value is not a string", function() {
				assert.throws(
					() => gauge.labels({ a: "1", b: 2 }),
					new Error("Expected value for label 'b' to be a string")
				);
				assert.throws(
					() => gauge.labels("1", 2),
					new Error("Expected value for label 'b' to be a string")
				);
			});
			it("should initialize a value for the label set", function() {
				gauge.labels({ a: "1", b: "2" });
				assert(gauge._values.has('a="1",b="2"'), "value was not set");
				gauge.labels("4", "5");
				assert(gauge._values.has('a="4",b="5"'), "value was not set");
			});
			it("should return a child supporting the usual methods", function() {
				let child = gauge.labels({ a: "1", b: "2" });
				child.get();
				child.inc();
				child.dec();
				child.setToCurrentTime();
				child = gauge.labels("7", "8");
				child.get();
				child.inc();
				child.dec();
				child.setToCurrentTime();
			});
			it("should return the same child for the same labels", function() {
				let child = gauge.labels("1", "2");
				assert.equal(gauge.labels("1", "2"), child);
				assert.equal(gauge.labels({ a: "1", b: "2" }), child);
			});
		});
		describe(".remove()", function() {
			it("should remove a label set created with .labels()", function() {
				let gauge = new prometheus.Gauge(
					"test", "Help", { register: false, labels: ["a", "b"] }
				);
				gauge.labels({ a: "1", b: "2" });
				gauge.remove({ a: "1", b: "2" });
				assert(!gauge._values.has('a="1",b="2"'), "value was not removed");
			});
			it("should throw when removing the empty label set", function() {
				let gauge = new prometheus.Gauge("test", "Help", { register: false });
				assert.throws(
					() => gauge.remove({}), new Error("labels cannot be empty")
				);
			});
		});
		describe(".removeAll()", function() {
			it("should remove a label set created with .labels()", function() {
				let gauge = new prometheus.Gauge(
					"test", "Help", { register: false, labels: ["a", "b"] }
				);
				gauge.labels("1", "2");
				gauge.labels("1", "3");
				gauge.labels("4", "6");
				gauge.removeAll({ a: "1" });
				assert(gauge._values.size <= 1, "Matching labels remained");
				assert(
					gauge._values.has('a="4",b="6"'),
					"Non-matching label was removed"
				);
			});
			it("should throw when removing the empty label set", function() {
				let gauge = new prometheus.Gauge("test", "Help", { register: false });
				assert.throws(
					() => gauge.removeAll({}), new Error("labels cannot be empty")
				);
			});
			it("should handle special characters", function() {
				let gauge = new prometheus.Gauge(
					"test", "Help", { register: false, labels: ["a", "b"] }
				);
				gauge.labels('x\\\\\n\"\"\n\\', "2");
				gauge.removeAll({ a: 'x\\\\\n\"\"\n\\' });
				assert(gauge._values.size === 0, "Matching labels remained");
			});
		});
		describe(".clear()", function() {
			it("should remove all label sets created with .labels()", function() {
				let gauge = new prometheus.Gauge(
					"test", "Help", { register: false, labels: ["a", "b"] }
				);
				gauge.labels({ a: "1", b: "2" });
				gauge.labels({ a: "3", b: "4" });
				gauge.labels({ a: "5", b: "6" });
				gauge.clear();
				assert(gauge._values.size === 0, "values was not cleared");
			});
			it("should throw when used on an unlabled metric", function() {
				let gauge = new prometheus.Gauge("test", "Help", { register: false });
				assert.throws(
					() => gauge.clear(), new Error("Cannot clear unlabeled metric")
				);
			});
		});
	});

	describe("defaultCollectors", function() {
		describe("processStartTimeSeconds", function() {
			it("should give a close point in time", async function() {
				this.skip(); // XXX Doesn't work in Clusterio's shared testing env
				let results = [];
				let collector = prometheus.defaultCollectors.processStartTimeSeconds;
				for await (let result of collector.collect()) {
					results.push(result);
				}

				assert(
					results.length === 1,
					"collector did not give exactly one result"
				);

				let value = results[0].samples.get("").get("");
				assert(
					Math.abs(value - Date.now() / 1000) < 1,
					"value set is not close to the current unix time"
				);
			});
		});
		describe("processCpuSecondsTotal", function() {
			it("should give a low value", async function() {
				this.skip(); // XXX Doesn't work in Clusterio's shared testing env
				let results = [];
				let collector = prometheus.defaultCollectors.processCpuSecondsTotal;
				for await (let result of collector.collect()) {
					results.push(result);
				}

				assert(
					results.length === 1,
					"collector did not give exactly one result"
				);

				let value = results[0].samples.get("").get("");
				assert(
					value < 5 && value > 0,
					`process time is not between 0 and 5 seconds (${value})`
				);
			});
		});
		describe("processResidentMemoryBytes", function() {
			it("should give a low value", async function() {
				this.skip(); // XXX Doesn't work in Clusterio's shared testing env
				let results = [];
				let collector = prometheus.defaultCollectors.processResidentMemoryBytes;
				for await (let result of collector.collect()) {
					results.push(result);
				}

				assert(
					results.length === 1,
					"collector did not give exactly one result"
				);

				let value = results[0].samples.get("").get("");
				assert(
					value < 200e6 && value > 0,
					`resident memory is not between 0 and 200 MB (${value})`
				);
			});
		});
		describe("processHeapBytes", function() {
			it("should give a low value", async function() {
				this.skip(); // XXX Doesn't work in Clusterio's shared testing env
				let results = [];
				let collector = prometheus.defaultCollectors.processHeapBytes;
				for await (let result of collector.collect()) {
					results.push(result);
				}

				assert(
					results.length === 1,
					"collector did not give exactly one result"
				);

				let value = results[0].samples.get("").get("");
				assert(
					value < 200e6 && value > 0,
					`heap is not between 0 and 200 MB (${value})`
				);
			});
		});
	});

	describe("exposition()", function() {
		it("should format simple metrics", async function() {
			let registry = new prometheus.CollectorRegistry();
			let counter = new prometheus.Counter("a", "Help", { register: false });
			registry.register(counter);
			let gauge = new prometheus.Gauge("b", "Help", { register: false });
			registry.register(gauge);
			let exposition = await prometheus.exposition(registry.collect());
			assert.equal(
				exposition,
				"# HELP a Help\n" +
				"# TYPE a counter\n" +
				"a 0\n" +
				"\n" +
				"# HELP b Help\n" +
				"# TYPE b gauge\n" +
				"b 0\n"
			);
		});
		it("should format labeled metrics", async function() {
			let registry = new prometheus.CollectorRegistry();
			let gauge = new prometheus.Gauge(
				"test", "Help", { register: false, labels: ["a", "b"] }
			);
			gauge.labels({ a: "1", b: "2" });
			gauge.labels({ b: "y", a: "x" });
			registry.register(gauge);
			let exposition = await prometheus.exposition(registry.collect());
			assert.equal(
				exposition,
				"# HELP test Help\n" +
				"# TYPE test gauge\n" +
				'test{a="1",b="2"} 0\n' +
				'test{a="x",b="y"} 0\n'
			);
		});
		it("should format histogram metrics", async function() {
			let registry = new prometheus.CollectorRegistry();
			let histogram = new prometheus.Histogram(
				"test", "Help", { register: false, buckets: [1, 2, 3, 4] }
			);
			for (let value of [2, 2, 5, 2]) {
				histogram.observe(value);
			}
			registry.register(histogram);
			let exposition = await prometheus.exposition(registry.collect());
			assert.equal(
				exposition,
				"# HELP test Help\n" +
				"# TYPE test histogram\n" +
				'test_bucket{le="1"} 0\n' +
				'test_bucket{le="2"} 3\n' +
				'test_bucket{le="3"} 3\n' +
				'test_bucket{le="4"} 3\n' +
				'test_bucket{le="+Inf"} 4\n' +
				"test_sum 11\n" +
				"test_count 4\n"
			);
		});
		it("should format histogram metrics with labels", async function() {
			let registry = new prometheus.CollectorRegistry();
			let histogram = new prometheus.Histogram(
				"test", "Help", { register: false, buckets: [1], labels: ["l"] }
			);
			for (let [value, label] of [[1, "a"], [2, "b"], [3, "b"]]) {
				histogram.labels(label).observe(value);
			}
			histogram.labels("c");

			registry.register(histogram);
			let exposition = await prometheus.exposition(registry.collect());
			assert.equal(
				exposition,
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
				'test_count{l="c"} 0\n'
			);
		});
		it("should format Infinity and NaN", async function() {
			let registry = new prometheus.CollectorRegistry();
			let gauge = new prometheus.Gauge(
				"test", "Help", { register: false, labels: ["n"] }
			);
			gauge.labels({ n: "1" }).set(Infinity);
			gauge.labels({ n: "2" }).set(-Infinity);
			gauge.labels({ n: "3" }).set(NaN);
			registry.register(gauge);
			let exposition = await prometheus.exposition(registry.collect());
			assert.equal(
				exposition,
				"# HELP test Help\n" +
				"# TYPE test gauge\n" +
				'test{n="1"} +Inf\n' +
				'test{n="2"} -Inf\n' +
				'test{n="3"} NaN\n'
			);
		});
	});

	let serializedResult = {
		metric: { type: "type", name: "name", help: "Help", labels: ["a", "b"] },
		samples: [["", [['a="1",b="2"', 1], ['a="3",b="4"', 5]]]],
	};
	let deserializedResult = {
		metric: new prometheus.Metric("type", "name", "Help", ["a", "b"]),
		samples: new Map([["", new Map([['a="1",b="2"', 1], ['a="3",b="4"', 5]])]]),
	};
	describe("serializeResult()", function() {
		it("should convert real results into the reference serialization", async function() {
			let counter = new prometheus.Counter("a_counter", "Counter", { register: false });
			let gauge = new prometheus.Gauge("a_gauge", "Gauge", { register: false, labels: ["a", "b"] });
			let registry = new prometheus.CollectorRegistry();
			registry.register(counter);
			registry.register(gauge);

			counter.inc(3);
			gauge.labels("1", "2").set(1);
			gauge.labels("3", "4").set(5);

			let results = [];
			for await (let result of registry.collect()) {
				results.push(result);
			}

			let referenceSerialization = [
				{
					metric: { type: "counter", name: "a_counter", help: "Counter", labels: [] },
					samples: [["", [["", 3]]]],
				},
				{
					metric: { type: "gauge", name: "a_gauge", help: "Gauge", labels: ["a", "b"] },
					samples: [["", [['a="1",b="2"', 1], ['a="3",b="4"', 5]]]],
				},
			];

			assert.deepEqual(
				results.map(result => prometheus.serializeResult(result)),
				referenceSerialization
			);
		});
		it("should support adding labels", function() {
			assert.deepEqual(
				prometheus.serializeResult({
					metric: new prometheus.Metric("type", "name", "Help"),
					samples: new Map([["name", new Map([["", 2]])]]),
				}, { addLabels: { c: "8" }}),
				{
					metric: { type: "type", name: "name", help: "Help", labels: ["c"] },
					samples: [["name", [['c="8"', 2]]]],
				}
			);
			assert.deepEqual(
				prometheus.serializeResult({
					metric: new prometheus.Metric("type", "name", "Help", ["a"]),
					samples: new Map([["", new Map([['a="4"', 3]])]]),
				}, { addLabels: { c: "8" }}),
				{
					metric: { type: "type", name: "name", help: "Help", labels: ["a", "c"] },
					samples: [["", [['a="4",c="8"', 3]]]],
				}
			);
		});
		it("should support redefining name and help", function() {
			assert.deepEqual(
				prometheus.serializeResult({
					metric: new prometheus.Metric("type", "name", "Help"),
					samples: new Map([["", new Map([["", 2]])]]),
				}, { metricName: "new" }),
				{
					metric: { type: "type", name: "new", help: "Help", labels: [] },
					samples: [["", [["", 2]]]],
				}
			);
			assert.deepEqual(
				prometheus.serializeResult({
					metric: new prometheus.Metric("type", "name", "Help"),
					samples: new Map([["", new Map([["", 2]])]]),
				}, { metricHelp: "old" }),
				{
					metric: { type: "type", name: "name", help: "old", labels: [] },
					samples: [["", [["", 2]]]],
				}
			);
		});
		it("should throw on unrecoginzed option", function() {
			assert.throws(
				() => prometheus.serializeResult({
					metric: new prometheus.Metric("type", "name", "Help"),
					samples: new Map([["", new Map([["", 3]])]]),
				}, { invalid: true }),
				new Error("Unrecognized option 'invalid'")
			);
		});
	});

	describe("deserializeResult()", function() {
		it("should convert a plain object into a result", function() {
			assert.deepEqual(
				prometheus.deserializeResult(serializedResult),
				deserializedResult
			);
		});
	});

	describe("integration", function() {
		it("should round trip serialize histogram results", async function() {
			let registry = new prometheus.CollectorRegistry();
			let histogram = new prometheus.Histogram(
				"test", "Help", { register: false, buckets: [1], labels: ["l"] }
			);
			for (let [value, label] of [[1, "a"], [2, "b"], [3, "b"]]) {
				histogram.labels(label).observe(value);
			}
			histogram.labels("c");

			registry.register(histogram);
			let results = [];
			for await (let result of registry.collect()) {
				results.push(result);
			}
			let exposition = await prometheus.exposition(results);

			let serialized = results.map(res => prometheus.serializeResult(res));
			let jsonRoundtrip = JSON.parse(JSON.stringify(serialized));
			let deserialized = jsonRoundtrip.map(res => prometheus.deserializeResult(res));
			assert.deepEqual(deserialized, results);
			let roundTripExposition = await prometheus.exposition(deserialized);

			assert.equal(roundTripExposition, exposition);
		});
	});

	describe("post test checks", function() {
		it("should not have any collectors in the default registry", function() {
			this.skip(); // XXX Doesn't work in Clusterio's shared testing env
			assert(
				prometheus.defaultRegistry.collectors.length === 0,
				"Collectors left over by test code"
			);
		});
	});
});
