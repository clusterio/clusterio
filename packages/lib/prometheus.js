"use strict";
class Metric {
	constructor(type, name, help, labels = [], _reserved_labels = []) {
		if (typeof name !== "string") {
			throw new Error("Expected name to be a string");
		}

		if (typeof help !== "string") {
			throw new Error("Expected help to be a string");
		}

		if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) {
			throw new Error(`Invalid name '${name}'`);
		}

		for (let label of labels) {
			if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label)) {
				throw new Error(`Invalid label '${label}'`);
			} else if (_reserved_labels.includes(label)) {
				throw new Error(`Reserved label '${label}'`);
			}
		}

		this.name = name;
		this.help = help;
		this.type = type;
		this.labels = labels;
	}
}

let defaultRegistry;

class Collector {
	constructor(register = true) {
		if (register) {
			defaultRegistry.register(this);
		}
	}

	async* collect() { }
}

function escapeLabelValue(value) {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/\n/g, "\\n")
		.replace(/"/g, "\\\"")
	;
}

function labelsToKey(labels, metricLabels) {
	let items = [];
	if (labels.length === 1 && typeof labels[0] === "object") {
		labels = labels[0];
		for (let name of metricLabels) {
			if (!Object.hasOwnProperty.call(labels, name)) {
				throw new Error(`Missing label '${name}'`);
			}
			if (typeof labels[name] !== "string") {
				throw new Error(
					`Expected value for label '${name}' to be a string`
				);
			}
			items.push(`${name}="${escapeLabelValue(labels[name])}"`);
		}

		for (let name of Object.keys(labels)) {
			if (!metricLabels.includes(name)) {
				throw new Error(`Extra label '${name}'`);
			}
		}

	} else {
		if (metricLabels.length > labels.length) {
			throw new Error(`Missing label '${metricLabels[labels.length]}'`);
		}

		if (labels.length > metricLabels.length) {
			throw new Error("Extra positional label");
		}

		for (let i=0; i < metricLabels.length; ++i) {
			if (typeof labels[i] !== "string") {
				throw new Error(
					`Expected value for label '${metricLabels[i]}' to be a string`
				);
			}
			items.push(`${metricLabels[i]}="${escapeLabelValue(labels[i])}"`);
		}
	}

	return items.join(",");
}

function keyToLabels(key) {
	let labels = new Map();

	if (key !== "") {
		for (let pair of key.split(",")) {
			let [name, value] = pair.split("=", 2);
			labels.set(name, value
				.slice(1, -1)
				.replace(/\\"/g, "\"")
				.replace(/\\n/g, "\n")
				.replace(/\\\\/g, "\\")
			);
		}
	}

	return labels;
}

function removeMatchingLabels(mapping, labels) {
	for (let key of mapping.keys()) {
		let candidate = keyToLabels(key);
		let hasLabels = Object.entries(labels).every(([name, value]) => (
			candidate.get(name) === value
		));
		if (hasLabels) {
			mapping.delete(key);
		}
	}
}

class LabeledCollector extends Collector {
	constructor(type, name, help, options, childClass) {
		let labels = [];
		let reservedLabels = [];
		let register = true;
		let callback = null;
		for (let [key, value] of Object.entries(options)) {
			if (key === "labels") {
				labels = value;
			} else if (key === "_reservedLabels") {
				reservedLabels = value;
			} else if (key === "register") {
				register = value;
			} else if (key === "callback") {
				callback = value;
			} else {
				throw new Error(`Unrecognized option '${key}'`);
			}
		}

		// Make sure we don't register to the default registry if metric throws.
		let metric = new Metric(type, name, help, labels, reservedLabels);

		super(register);

		this.callback = callback;
		this.metric = metric;
		this._children = new Map();
		this._childClass = childClass;
	}

	labels(...labels) {
		let key = labelsToKey(labels, this.metric.labels);
		let child = this._children.get(key);
		if (child === undefined) {
			child = new this._childClass(this, key);
			this._children.set(key, child);
		}
		return child;
	}

	remove(...labels) {
		let key = labelsToKey(labels, this.metric.labels);
		if (key === "") {
			throw new Error("labels cannot be empty");
		}
		this._children.delete(key);
		return key;
	}

	removeAll(labels) {
		if (!Object.keys(labels).length) {
			throw new Error("labels cannot be empty");
		}

		removeMatchingLabels(this._children, labels);
	}

	clear() {
		if (!this.metric.labels.length) {
			throw new Error("Cannot clear unlabeled metric");
		}
		this._children = new Map();
	}
}

class ValueCollector extends LabeledCollector {
	constructor(type, name, help, options, childClass) {
		super(type, name, help, options, childClass);

		this._values = new Map();
		this._defaultChild = this.metric.labels.length ? null : this.labels({});
	}

	async* collect() {
		if (this.callback) { await this.callback(this); }
		yield { metric: this.metric, samples: new Map([["", this._values]]) };
	}

	get() {
		return this._defaultChild.get();
	}

	remove(...labels) {
		let key = super.remove(...labels);
		this._values.delete(key);
	}

	removeAll(labels) {
		super.removeAll(labels);
		removeMatchingLabels(this._values, labels);
	}

	clear() {
		super.clear();
		this._values = new Map();
	}
}

class ValueCollectorChild {
	constructor(collector, key) {
		this._values = collector._values;
		this._key = key;

		this._values.set(key, 0);
	}

	get() {
		return this._values.get(this._key);
	}
}

class CounterChild extends ValueCollectorChild {
	inc(value = 1) {
		// Note: Inverted to also catch NaN
		if (!(value >= 0)) {
			throw new Error("Expected value to be a positive number");
		}

		this._values.set(this._key, this._values.get(this._key) + value);
	}
}

class Counter extends ValueCollector {
	constructor(name, help, options = {}) {
		super("counter", name, help, options, CounterChild);
	}

	inc(value = 1) {
		this._defaultChild.inc(value);
	}
}

class GaugeChild extends ValueCollectorChild {
	inc(value = 1) {
		this._values.set(this._key, this._values.get(this._key) + value);
	}

	dec(value = 1) {
		this._values.set(this._key, this._values.get(this._key) - value);
	}

	set(value) {
		this._values.set(this._key, value);
	}

	setToCurrentTime() {
		this._values.set(this._key, Date.now() / 1000);
	}
}

class Gauge extends ValueCollector {
	constructor(name, help, options = {}) {
		super("gauge", name, help, options, GaugeChild);
	}

	inc(value = 1) {
		this._defaultChild.inc(value);
	}

	dec(value = 1) {
		this._defaultChild.dec(value);
	}

	set(value) {
		this._defaultChild.set(value);
	}

	setToCurrentTime() {
		this._defaultChild.setToCurrentTime();
	}
}

function formatValue(value) {
	if (value === Infinity) {
		return "+Inf";
	}
	if (value === -Infinity) {
		return "-Inf";
	}
	return value.toString();
}

function formatBucketKey(bucket, key) {
	return `${key === "" ? "" : `${key},`}le="${formatValue(bucket)}"`;
}

class HistogramChild {
	constructor(collector, key) {
		this._bucketValues = collector._bucketValues;
		this._sumValues = collector._sumValues;
		this._countValues = collector._countValues;
		this._key = key;

		this._bucketKeys = new Map();
		for (let bucket of collector._buckets) {
			let bucketKey = formatBucketKey(bucket, this._key);

			this._bucketKeys.set(bucket, bucketKey);
			this._bucketValues.set(bucketKey, 0);
		}

		this._sumValues.set(key, 0);
		this._countValues.set(key, 0);
	}

	get buckets() {
		return new Map(
			[...this._bucketKeys].map(
				([bucket, key]) => [bucket, this._bucketValues.get(key)]
			)
		);
	}

	get sum() {
		return this._sumValues.get(this._key);
	}

	get count() {
		return this._countValues.get(this._key);
	}

	observe(value) {
		for (let [bound, key] of this._bucketKeys) {
			if (value <= bound) {
				this._bucketValues.set(key, this._bucketValues.get(key) + 1);
			}
		}

		this._sumValues.set(this._key, this._sumValues.get(this._key) + value);
		this._countValues.set(this._key, this._countValues.get(this._key) + 1);
	}

	startTimer() {
		let start = process.hrtime.bigint();
		return () => {
			let end = process.hrtime.bigint();
			this.observe(Number(end - start) / 1e9);
		};
	}
}

class Histogram extends LabeledCollector {
	constructor(name, help, options = {}) {
		// These defaults are taken from the Python Prometheus client
		let buckets = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10, Infinity];

		let parentOptions = { _reservedLabels: ["le"] };
		for (let [key, value] of Object.entries(options)) {
			if (key === "buckets") {
				buckets = value;
			} else {
				parentOptions[key] = value;
			}
		}

		super("histogram", name, help, parentOptions, HistogramChild);

		if (buckets.slice(-1)[0] !== Infinity) {
			buckets = [...buckets, Infinity];
		}

		this._buckets = buckets;
		this._bucketValues = new Map();
		this._sumValues = new Map();
		this._countValues = new Map();
		this._defaultChild = this.metric.labels.length ? null : this.labels({});
	}

	async* collect() {
		if (this.callback) { await this.callback(this); }
		yield {
			metric: this.metric,
			samples: new Map([
				["_bucket", this._bucketValues],
				["_sum", this._sumValues],
				["_count", this._countValues],
			]),
		};
	}

	get buckets() {
		return this._defaultChild.buckets;
	}

	get sum() {
		return this._defaultChild.sum;
	}

	get count() {
		return this._defaultChild.count;
	}

	observe(value) {
		this._defaultChild.observe(value);
	}

	startTimer() {
		return this._defaultChild.startTimer();
	}

	remove(...labels) {
		let key = super.remove(...labels);
		for (let bucket of this._buckets) {
			let bucketKey = formatBucketKey(bucket, key);
			this._bucketValues.delete(bucketKey);
		}
		this._sumValues.delete(key);
		this._countValues.delete(key);
	}

	removeAll(labels) {
		super.removeAll(labels);
		for (let bucket of this._buckets) {
			removeMatchingLabels(
				this._bucketValues, { ...labels, le: formatValue(bucket) }
			);
		}
		removeMatchingLabels(this._sumValues, labels);
		removeMatchingLabels(this._countValues, labels);
	}

	clear() {
		super.clear();
		this._bucketValues = new Map();
		this._sumValues = new Map();
		this._countValues = new Map();
	}
}

Histogram.linear = function linear(start, width, count) {
	let buckets = [];
	for (let i = 0; i < count; i++) {
		buckets.push(start);
		start += width;
	}
	return buckets;
};

Histogram.exponential = function exponential(start, factor, count) {
	let buckets = [];
	for (let i = 0; i < count; i++) {
		buckets.push(start);
		start *= factor;
	}
	return buckets;
};

class CollectorRegistry {
	constructor() {
		this.collectors = [];
	}

	async* collect() {
		for (let collector of this.collectors) {
			for await (let result of collector.collect()) {
				yield result;
			}
		}
	}

	register(metric) {
		let index = this.collectors.lastIndexOf(metric);
		if (index !== -1) {
			throw new Error(
				"Collector is already registered in this registry."
			);
		}

		this.collectors.push(metric);
	}

	unregister(metric) {
		let index = this.collectors.lastIndexOf(metric);
		if (index === -1) {
			throw new Error(
				"Collector is not registered in this registry."
			);
		}

		this.collectors.splice(index, 1);
	}
}

defaultRegistry = new CollectorRegistry();

function escapeHelp(help) {
	return help
		.replace(/\\/g, "\\\\")
		.replace(/\n/g, "\\n")
	;
}

async function* expositionLines(resultsIterator) {
	let first = true;
	for await (let result of resultsIterator) {
		if (first) {
			first = false;
		} else {
			yield "\n";
		}

		yield `# HELP ${result.metric.name} ${escapeHelp(result.metric.help)}\n`;
		yield `# TYPE ${result.metric.name} ${result.metric.type}\n`;

		for (let [suffix, samples] of result.samples) {
			for (let [key, value] of samples) {
				if (key === "") {
					yield `${result.metric.name}${suffix} ${formatValue(value)}\n`;
				} else {
					yield `${result.metric.name}${suffix}{${key}} ${formatValue(value)}\n`;
				}
			}
		}
	}
}

async function exposition(resultsIterator = defaultRegistry.collect()) {
	let lines = "";
	for await (let line of expositionLines(resultsIterator)) {
		lines += line;
	}
	return lines;
}

// HTTP Content-Type for the exposition format that's implemented
exposition.contentType = "text/plain; version=0.0.4";

function serializeResult(result, options = {}) {
	let addLabels = null;
	let metricName = result.metric.name;
	let metricHelp = result.metric.help;
	for (let [name, value] of Object.entries(options)) {
		if (name === "addLabels") {
			addLabels = value;
		} else if (name === "metricName") {
			metricName = value;
		} else if (name === "metricHelp") {
			metricHelp = value;
		} else {
			throw new Error(`Unrecognized option '${name}'`);
		}
	}

	let samples;
	if (addLabels === null) {
		samples = result.samples;
		addLabels = {};

	} else {
		samples = new Map();
		let key = labelsToKey([addLabels], [...Object.keys(addLabels)]);
		for (let [suffix, suffixSamples] of result.samples) {
			let labeledSamples = new Map();
			for (let [labels, value] of suffixSamples) {
				if (labels === "") {
					labeledSamples.set(key, value);
				} else {
					labeledSamples.set(`${labels},${key}`, value);
				}
			}
			samples.set(suffix, labeledSamples);
		}
	}

	return {
		metric: {
			type: result.metric.type,
			name: metricName,
			help: metricHelp,
			labels: [...result.metric.labels, ...Object.keys(addLabels)],
		},
		samples: [...samples].map(([name, metricSamples]) => [name, [...metricSamples]]),
	};
}

function deserializeResult(serializedResult) {
	return {
		metric: new Metric(
			serializedResult.metric.type,
			serializedResult.metric.name,
			serializedResult.metric.help,
			serializedResult.metric.labels,
		),
		samples: new Map(
			serializedResult.samples.map(
				([suffix, suffixSamples]) => [suffix, new Map(suffixSamples)]
			)
		),
	};
}

let defaultCollectors = {};
defaultCollectors.processCpuSecondsTotal = new Gauge(
	"process_cpu_seconds_total",
	"Total user and system CPU time spent in seconds.",
	{
		callback: async function() {
			let usage = process.cpuUsage();
			this.set((usage.user + usage.system) / 1e6);
		},
	},
);

defaultCollectors.processResidentMemoryBytes = new Gauge(
	"process_resident_memory_bytes",
	"Resident memory size in bytes.",
	{
		callback: function() {
			this.set(process.memoryUsage().rss);
		},
	},
);

defaultCollectors.processHeapBytes = new Gauge(
	"process_heap_bytes",
	"Process heap size in bytes.",
	{
		callback: function() {
			this.set(process.memoryUsage().heapUsed);
		},
	},
);

defaultCollectors.processStartTimeSeconds = new Gauge(
	"process_start_time_seconds",
	"Start time of the process since unix epoch in seconds."
);
defaultCollectors.processStartTimeSeconds.setToCurrentTime();


module.exports = {
	Counter,
	Gauge,
	Histogram,
	CollectorRegistry,
	Collector,
	ValueCollector,
	Metric,

	exposition,
	defaultRegistry,
	defaultCollectors,
	serializeResult,
	deserializeResult,
};
