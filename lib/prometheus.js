"use strict";
class Metric {
	constructor(type, name, help, labels = []) {
		if (typeof name !== "string") {
			throw new Error("Expected name to be a string");
		}

		if (typeof help !== "string") {
			throw new Error("Expected help to be a string");
		}

		if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) {
			throw new Error(`Invalid name '${name}'`);
		}

		for (let name of labels) {
			if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
				throw new Error(`Invalid label '${name}'`);
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

	if (key !== "") for (let pair of key.split(",")) {
		let [name, value] = pair.split("=", 2);
		labels.set(name, value
			.slice(1, -1)
			.replace(/\\"/g, "\"")
			.replace(/\\n/g, "\n")
			.replace(/\\\\/g, "\\")
		);
	}

	return labels;
}

class ValueCollector extends Collector {
	constructor(type, name, help, options, childClass) {
		let labels = [];
		let register = true;
		let callback = null;
		for (let [name, value] of Object.entries(options)) {
			if (name === "labels") { labels = value; }
			else if (name === "register") { register = value; }
			else if (name === "callback") { callback = value; }
			else { throw new Error(`Unrecognized option '${name}'`); }
		}

		// Make sure we don't register to the default registry if metric throws.
		let metric = new Metric(type, name, help, labels);

		super(register);

		this.callback = callback;
		this.metric = metric;
		this._values = new Map();
		this._children = new Map();
		this._childClass = childClass;
		this._defaultChild = labels.length ? null : this.labels({});
	}

	async* collect() {
		if (this.callback) { await this.callback(this); }
		yield { metric: this.metric, samples: this._values };
	}

	get() {
		return this._defaultChild.get();
	}

	labels(...labels) {
		let key = labelsToKey(labels, this.metric.labels);
		let child = this._children.get(key);
		if (child === undefined) {
			child = new this._childClass(this._values, key);
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
		this._values.delete(key);
	}

	removeAll(labels) {
		if (!Object.keys(labels).length) {
			throw new Error("labels cannot be empty");
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

		removeMatchingLabels(this._values, labels);
		removeMatchingLabels(this._children, labels);
	}

	clear() {
		if (!this.metric.labels.length) {
			throw new Error("Cannot clear unlabeled metric");
		}
		this._children = new Map();
		this._values = new Map();
	}
}

class ValueCollectorChild {
	constructor(values, key) {
		this._values = values;
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

function formatValue(value) {
	if (value === Infinity) {
		return "+Inf";
	} else if (value === -Infinity) {
		return "-Inf";
	} else {
		return value.toString();
	}
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

		for (let [key, value] of result.samples) {
			if (key === "") {
				yield `${result.metric.name} ${formatValue(value)}\n`;
			} else {
				yield `${result.metric.name}{${key}} ${formatValue(value)}\n`;
			}
		}
	}
}

async function exposition(resultsIterator = defaultRegistry.collect()) {
	let exposition = "";
	for await (let line of expositionLines(resultsIterator)) {
		exposition += line;
	}
	return exposition;
}

// HTTP Content-Type for the exposition format that's implemented
exposition.contentType = "text/plain; version=0.0.4";

function serializeResult(result, options = {}) {
	let addLabels = null;
	let metricName = result.metric.name;
	let metricHelp = result.metric.help;
	for (let [name, value] of Object.entries(options)) {
		if (name === "addLabels") { addLabels = value; }
		else if (name === "metricName") { metricName = value; }
		else if (name === "metricHelp") { metricHelp = value; }
		else { throw new Error(`Unrecognized option '${name}'`); }
	}

	let samples;
	if (addLabels === null) {
		samples = result.samples;
		addLabels = {};

	} else {
		samples = new Map();
		let key = labelsToKey([addLabels], [...Object.keys(addLabels)]);
		for (let [labels, value] of result.samples.entries()) {
			if (labels === "") { samples.set(key, value); }
			else { samples.set(`${labels},${key}`, value); }
		}
	}

	return {
		metric: {
			type: result.metric.type,
			name: metricName,
			help: metricHelp,
			labels: [...result.metric.labels, ...Object.keys(addLabels)],
		},
		samples: [...samples.entries()],
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
		samples: new Map(serializedResult.samples),
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
