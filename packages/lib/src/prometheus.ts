/**
 * Asynchronous Prometheus client
 *
 * Prometheus client for exposing metrics to a Prometheus server based on
 * (possibly) asynchronous callbacks.  This library was developed as a
 * replacement for prom-client in Clusterio due to the lack of callbacks on
 * metric collections in prom-client.
 *
 * The ordinary use case of instrumenting a code base should be covered by
 * {@link Counter}, {@link Gauge}, {@link Histogram} and
 * {@link exposition}.  See documentation for each of
 * the listed interfaces for more information.
 *
 * @example
 * const { Counter, exposition } = require("@clusterio/lib");
 *
 * // Collectors are by default registered to the default collector regitry.
 * const totalRequests = new Counter(
 *     "app_request_count_total",
 *     "Total requests handled.",
 * );
 *
 * function handleRequest(...) {
 *     // Do stuff
 *     totalRequests.inc();
 * }
 *
 * // Code handling the /metrics HTTP request, here shown for express
 * // but any http framework may be used
 * const app = require("express")();
 * async function getMetrics(req, res) {
 *     // By default exposition uses the default collector registry
 *     let text = await exposition();
 *     res.set("Content-Type", exposition.contentType);
 *     res.send(text);
 * }
 * app.get("/metrics", (req, res, next) => getMetrics(req, res).catch(next));
 * app.listen(9100);
 * @module lib/prometheus
 */

/**
 * Result from collecting a {@link Collector}
 *
 * @example
 * Simple Metric
 * ```ts
 * let result = {
 *     metric: new Metric("count", "simple_total_count", "A simple counter"),
 *     samples: new Map([
 *         ["", new Map([
 *             ["", 123],
 *         ])],
 *     ]),
 * }
 * ```
 *
 * @example
 * Labeled Metric
 * ```ts
 * let result = {
 *     metric: new Metric(
 *         "count", "labeled_total_count", "A labeled counter", ["a", "b"]
 *     ),
 *     samples: new Map([
 *         ["", new Map([
 *             ['a="1",b="3"', 123],
 *             ['a="2",b="1"', 34],
 *             ['a="2",b="9"', 7],
 *         ])],
 *     ]),
 * }
 * ```
 *
 * @example
 * Histogram Metric
 * ```ts
 * let result = {
 *     metric: new Metric(
 *         "histogram", "histogram_size", "A histogram of sizes"
 *     ),
 *     samples: new Map([
 *         ["_bucket", new Map([
 *             ['le="1"', 1],
 *             ['le="5"', 4],
 *             ['le="+Inf"', 5],
 *         ])],
 *         ["_sum", new Map([
 *             ["", 48],
 *         ])],
 *         ["_count", new Map([
 *             ["", 5],
 *         ])],
 *     ]),
 * }
 */
export interface CollectorResult {
	/** Metric collected. */
	metric: Metric;
	/**
	 * Mapping of metric suffix to mapping of label keys to values
	 * collected.  For normal metrics the first level contains a single
	 * entry under the empty string as key.  If the metric does not have
	 * labels the second level also contains a single entry under the empty
	 * string as a key.
	 */
	samples: Map<string, Map<string, number>>;
}

export type MetricType = "counter" | "gauge" | "histogram" | "summary" | "untyped";

/**
 * Represents a collectable metric
 *
 * Used in implementing collectors in order to validate the name, help text
 * and labels attached to the collector.
 */
export class Metric {
	constructor(
		/**
		 * Metric type, should be one of `counter`, `gauge`, `histogram`,
		 * `summary` or `untyped`.
		 */
		public type: MetricType,
		/** Name of the metric */
		public name: string,
		/** Help text for the metric */
		public help: string,
		/** Labels for this metric.  */
		public labels: string[] = [],
		_reserved_labels: string[] = []
	) {
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
	}
}

/**
 * The default registry which collectors are regististered to.
 */
export let defaultRegistry: CollectorRegistry;

/**
 * Base class for all collectors
 *
 * This servers mostly as a conceptual base for all collectors, the only
 * feature implemented here is registring to the default registry on
 * construction.  If you want to implement a custom collector you most
 * likely want to base it on {@link LabeledCollector}
 * instead.
 */
export class Collector {
	/**
	 * Create collector
	 *
	 * @param register -
	 *     Whether to register this collector to the default registry.
	 */
	constructor(register = true) {
		if (register) {
			defaultRegistry.register(this);
		}
	}

	/**
	 * Retrieve metric data from this collctor.
	 *
	 * Called by {@link CollectorRegistry} to gather
	 * the metric data this Collector exports.
	 */
	async* collect(): AsyncIterable<CollectorResult> { }
}

const labelEscapesChars = /[\\\n\"]/;
/**
 * Escapes a label value in accordance with the text exposition format
 *
 * @param value - Value to escape.
 * @returns escaped value with \, ", and newline escaped.
 * @private
 */
function escapeLabelValue(value: string) {
	if (!labelEscapesChars.test(value)) {
		return value;
	}
	return value
		.replace(/\\/g, "\\\\")
		.replace(/\n/g, "\\n")
		.replace(/"/g, "\\\"")
	;
}

export type LabelValues = string[] | [Record<string, string>];

/**
 * Convert label expression to unique string
 *
 * @param labels -
 *     label values to compute key for.
 * @param metricLabels - labels defined for the metric.
 * @returns computed key
 * @private
 */
function labelsToKey(labels: LabelValues, metricLabels: string[]) {
	let items = [];
	if (labels.length === 1 && typeof labels[0] === "object") {
		let labelObj = labels[0];
		for (let name of metricLabels) {
			if (!Object.hasOwnProperty.call(labelObj, name)) {
				throw new Error(`Missing label '${name}'`);
			}
			if (typeof labelObj[name] !== "string") {
				throw new Error(
					`Expected value for label '${name}' to be a string`
				);
			}
			items.push(`${name}="${escapeLabelValue(labelObj[name])}"`);
		}

		for (let name of Object.keys(labelObj)) {
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
			let label = labels[i];
			if (typeof label !== "string") {
				throw new Error(
					`Expected value for label '${metricLabels[i]}' to be a string`
				);
			}
			items.push(`${metricLabels[i]}="${escapeLabelValue(label)}"`);
		}
	}

	if (items.length === 1) {
		return items[0];
	}

	return items.join(",");
}

function keyToLabels(key: string) {
	let labels = new Map<string, string>();

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

function removeMatchingLabels(mapping: Map<string, unknown>, labels: Record<string, string>) {
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

/**
 * Base class for implementing labeled collectors
 *
 * Provides the scaffolding for creating labled collectors where each label
 * set is a child to the collector that can be retrieved with the .labels()
 * method.
 *
 * @extends Collector
 */
export class LabeledCollector<Child> extends Collector {
	callback: ((collector: any) => (void | Promise<void>)) | undefined;
	metric: Metric;

	private _children: Map<string, Child>;
	private _childClass: { new(collector: any, key: string): Child };

	/**
	 * Create optionally labeled collector
	 *
	 * @param type - Type for metric.
	 * @param name - Name of the metric.
	 * @param help - Help text for metric.
	 * @param options - options for collector.
	 * @param options.labels -
	 *     Labels for this metric, defaults to no labels.
	 * @param options._reservedLabels -
	 *     Labels which may not be used.  Is passed to Metric constructor.
	 * @param options.register -
	 *     If true registers this collector with the default registry.
	 *     Defaults to true.
	 * @param options.callback -
	 *     Possibly async function that is called before the metric is
	 *     collected.  The collector being collected is passed as the
	 *     argument.
	 * @param childClass -
	 *     Constructor taking instance of collector and label key as
	 *     arguments and returns a child instance.
	 */
	constructor(
		type: MetricType,
		name: string,
		help: string,
		options: {
			labels?: string[],
			_reservedLabels?: string[],
			register?: boolean,
			callback?: (collector: any) => (void | Promise<void>),
		},
		childClass: { new(collector: any, key: string): Child }
	) {
		const { labels = [], _reservedLabels = [], register = true, callback, ...rest } = options;

		for (let key of Object.keys(rest)) {
			throw new Error(`Unrecognized option '${key}'`);
		}

		// Make sure we don't register to the default registry if metric throws.
		let metric = new Metric(type, name, help, labels, _reservedLabels);

		super(register);

		this.callback = callback;
		this.metric = metric;
		this._children = new Map();
		this._childClass = childClass;
	}

	/**
	 * Access child collector with the given labels.
	 *
	 * Creates a labeled child collector for this collector.  The child
	 * supports the methods of Collector for modifying and querying the
	 * value of the metric.
	 *
	 * Once created, a value is initialized for the label values used and
	 * exported from the collector until it's removed explicitly with
	 * the .remove() or .removeAll() methods.
	 *
	 * @param labels -
	 *     A string value passed for each label defined on the metric in the
	 *     same order as the labels option given to the collector, or an
	 *     object mapping label name to label value.
	 * @returns Child collector for the given labels.
	 */
	labels(...labels: LabelValues): Child {
		let key = labelsToKey(labels, this.metric.labels);
		let child = this._children.get(key);
		if (child === undefined) {
			child = new this._childClass(this, key);
			this._children.set(key, child);
		}
		return child;
	}

	/**
	 * Remove child collector and data for a given label set
	 *
	 * Remove the child collector and the value it stores from the collector
	 * itself.  This will remove the entry exported for the given labels.
	 *
	 * @param labels -
	 *     A string value passed for each label defined on the metric in the
	 *     same order as the labels option given to the collector, or an
	 *     object mapping label name to label value.
	 * @returns key for labels to remove (for use in subclasses).
	 */
	remove(...labels: LabelValues) {
		let key = labelsToKey(labels, this.metric.labels);
		if (key === "") {
			throw new Error("labels cannot be empty");
		}
		this._children.delete(key);
		return key;
	}

	/**
	 * Remove child collectors matching a partial label set
	 *
	 * Removes all child collecters which has labels matching the ones given
	 * in labels parameter, Unline .remove this can be a partial set of
	 * labels and all child collectors with their stored values that shares
	 * this set of labels will be removed.
	 *
	 * @param {Object<string,string>} labels -
	 *     Object mapping with label name to label values that should be
	 *     matches.
	 */
	removeAll(labels: Record<string, string>) {
		if (!Object.keys(labels).length) {
			throw new Error("labels cannot be empty");
		}

		removeMatchingLabels(this._children, labels);
	}

	/**
	 * Clear all labeles on this collector
	 *
	 * Clears all child collectors from this collector along with their
	 * stored values.  This effectively removes all the exported values.
	 */
	clear() {
		if (!this.metric.labels.length) {
			throw new Error("Cannot clear unlabeled metric");
		}
		this._children = new Map();
	}
}

/**
 * Base class for implementing single value per label collectors
 *
 * @extends LabeledCollector
 */
export class ValueCollector<Child extends { get(): number }> extends LabeledCollector<Child> {
	_values: Map<string, number>;
	protected _defaultChild: Child | null;

	/**
	 * Create optionally labeled value collector
	 *
	 * @param type - Type for metric.
	 * @param name - Name of the metric.
	 * @param help - Help text for metric.
	 * @param options - options for collector.
	 * @param options.labels -
	 *     Labels for this metric, defaults to no labels.
	 * @param options._reservedLabels -
	 *     Labels which may not be used.  Is passed to Metric constructor.
	 * @param options.register -
	 *     If true registers this collector with the default registry.
	 *     Defaults to true.
	 * @param options.callback -
	 *     Possibly async function that is called before the collector value
	 *     is collected.  The collector being collected is passed as the
	 *     argument.
	 * @param childClass -
	 *     Constructor taking instance of collector and label key as
	 *     arguments and returns a child instance.
	 */
	constructor(
		type: MetricType,
		name: string,
		help: string,
		options: {
			labels?: string[],
			_reservedLabels?: string[],
			register?: boolean,
			callback?: (collector: any) => (void | Promise<void>),
		},
		childClass: { new(collector: ValueCollector<Child>, key: string): Child }
	) {
		super(type, name, help, options, childClass);

		this._values = new Map();
		this._defaultChild = this.metric.labels.length ? null : this.labels({});
	}

	async* collect() {
		if (this.callback) { await this.callback(this); }
		yield { metric: this.metric, samples: new Map([["", this._values]]) };
	}

	/**
	 * Get the current value for this collector.
	 *
	 * Note: Only works if this is an unlabeled collector.
	 * @returns value stored.
	 */
	get() {
		return this._defaultChild!.get();
	}

	remove(...labels: LabelValues) {
		let key = super.remove(...labels);
		this._values.delete(key);
		return key;
	}

	removeAll(labels: Record<string, string>) {
		super.removeAll(labels);
		removeMatchingLabels(this._values, labels);
	}

	clear() {
		super.clear();
		this._values = new Map();
	}
}

/**
 * Child collector representing the value of a single label set
 */
class ValueCollectorChild {
	protected _values: Map<string, number>;
	protected _key: string;

	constructor(collector: ValueCollector<ValueCollectorChild>, key: string) {
		this._values = collector._values;
		this._key = key;

		this._values.set(key, 0);
	}

	/**
	 * Returns the current value of label set
	 *
	 * @returns value stored.
	 */
	get() {
		return this._values.get(this._key)!;
	}
}

/**
 * Child counter holding the value for a single label set.
 * @extends ValueCollectorChild
 */
class CounterChild extends ValueCollectorChild {
	/**
	 * Increment counter for label set
	 * @param value - Positive number to increment by.
	 */
	inc(value = 1) {
		// Note: Inverted to also catch NaN
		if (!(value >= 0)) {
			throw new Error("Expected value to be a positive number");
		}

		this._values.set(this._key, this._values.get(this._key)! + value);
	}
}

/**
 * Basic increasing counter
 *
 * Stores and exports an optionally labeled counter metric.  This is one of
 * the two basic building blocks for instrumenting code and represents a
 * metric that can only increase in value, such as the total number of
 * requests processed or total time spent processing requests.
 *
 * Counters should be created at module load time and referenced in the
 * functions that increment them, for example:
 *
 * ```ts
 * const totalRequests = new Counter(
 *     "app_request_count_total",
 *     "Total requests handled.",
 * );
 *
 * function handleRequest(...) {
 *     // Do stuff
 *     totalRequests.inc();
 * }
 * ```
 *
 * The `totalRequests` counter will register with the default registry and
 * provided exposition is set up (see {@link exposition}) the counter will
 * be exported to Prometheus starting out with a value of 0.  And that is
 * all there is to it.
 *
 * It is sometimes useful however to divide a metric up into diffrent
 * sections, for example to have a different count for each endpoint handled
 * or one count for successfull requests and one for requests resulting in
 * an error.  For this Prometheus provides labels, and to use them pass the
 * labels option as the third argument to Counter:
 *
 * ```ts
 * const totalRequests = new Counter(
 *     "app_request_count_total",
 *     "Total requests handled.",
 *     { labels: ["endpoint", "status"] },
 * );
 *
 * function handleRequest(endpoint, ...) {
 *     let status = "ok";
 *     try {
 *         // Do stuff
 *     } catch (err) {
 *         status = "err";
 *     } finally {
 *         totalRequests.labels(endpoint, status).inc();
 *     }
 * }
 * ```
 *
 * When using labels the counter no longer gets a default value and it's no
 * longer possible to use the `.inc()` method on the counter itself, the
 * `.labels()` method has to be invoked with the values for the labels
 * defined.  `.labels()` returns a child counter for the label values given
 * to it and this child can be operated on and cached for performance if
 * that is critical.
 *
 * The lack of a default value may cause issues with aggregating and
 * querying the counter values in Prometheus.  It is therefore recommended
 * where possible to initialize all possible combinations of label values
 * that will be used.  This is done by calling `.labels()` for each
 * combination, for example:
 *
 * ```ts
 * for (let endpoint of allEndpoints) {
 *     for (let status of ["ok", "err"]) {
 *         totalRequests.labels(endpoint, status);
 *     }
 * }
 * ```
 *
 * Note that every combination of label values used creates a new time
 * series to be stored and processed.  You should carefully evaluate which
 * labels you actually need as resource usage for a metric increases
 * exponentially with the number of labels used.
 *
 * @extends ValueCollector
 */
export class Counter extends ValueCollector<CounterChild> {
	/**
	 * Create optionally labeled counter
	 *
	 * @param name - Name of the metric.
	 * @param help - Help text for metric.
	 * @param options - options for collector.
	 * @param {Array<string>=} options.labels -
	 *     Labels for this metric, defaults to no labels.
	 * @param {boolean=} options.register -
	 *     If true registers this collector with the default registry.
	 *     Defaults to true.
	 * @param {function()=} options.callback -
	 *     Possibly async function that is called when the metric is
	 *     collected.  The collector being collected is passed as the
	 *     argument.
	 */
	constructor(
		name: string,
		help: string,
		options: {
			labels?: string[],
			register?: boolean,
			callback?: (collector: Collector) => (void | Promise<void>),
		} = {},
	) {
		super("counter", name, help, options, CounterChild);
	}

	/**
	 * Increment counter value
	 *
	 * Note: Only works if this is an unlabeled collector.
	 * @param value - Positive number to increment by.
	 */
	inc(value = 1) {
		this._defaultChild!.inc(value);
	}
}

/**
 * Child gauge holding the value for a single label set.
 * @extends ValueCollectorChild
 */
class GaugeChild extends ValueCollectorChild {
	/**
	 * Increment gague for label set
	 *
	 * @param value - number to increment by.
	 */
	inc(value = 1) {
		this._values.set(this._key, this._values.get(this._key)! + value);
	}

	/**
	 * Decrement gague for label set
	 *
	 * @param value - number to decrease by.
	 */
	dec(value = 1) {
		this._values.set(this._key, this._values.get(this._key)! - value);
	}

	/**
	 * Set gague for label set
	 *
	 * @param value - number to set gauge to.
	 */
	set(value: number) {
		this._values.set(this._key, value);
	}

	/**
	 * Set to current Unix epoch time in seconds for label set
	 */
	setToCurrentTime() {
		this._values.set(this._key, Date.now() / 1000);
	}

	/**
	 * Start a timer for setting a duration for label set
	 *
	 * @returns
	 *     function that when called will set the guage to the duration in
	 *     seconds from when the timer was started
	 */
	startTimer() {
		let start = process.hrtime.bigint();
		return () => {
			let end = process.hrtime.bigint();
			this.set(Number(end - start) / 1e9);
		};
	}
}

/**
 * Basic value metric
 *
 * Stores and exports an optionally labeled value metric.  This is one of
 * the two basic building blocks for instrumenting code and represents a
 * value that can both increase and decrease over time, such as the number
 * of requests in-flight or the number of users in a database.
 *
 * Gauges should be created at module load time and referenced in the
 * functions that modify them, for example:
 *
 * ```ts
 * const activeRequests = new Gauge(
 *     "app_active_request_count",
 *     "Number of requests in-flight.",
 * );
 *
 * async function handleRequest(...) {
 *     activeRequests.inc();
 *     try {
 *         // Do async stuff
 *     } finally {
 *         activeRequests.dec();
 *     }
 * }
 * ```
 *
 * The `activeRequests` gauge will register with the default registry and
 * provided exposition is set up (see {@link exposition}) the gauge will be
 * exported to Prometheus starting out with a value of 0.
 *
 * Sometimes keeping track of the value measured is impractical or
 * prohibitly expensive.  In those cases you can update the value
 * of the collector as it's being collected for export with a callback
 * function passed as one of the options.
 *
 * ```ts
 * const userCount = new Gauge(
 *     "app_user_count",
 *     "Number of users in the app.",
 *     {
 *         callback: async function() {
 *             // Make sure this request can not take a long time to
 *             // complete as that will cause the metrics gathering
 *             // to time out.
 *             userCount.set(await someApi.getUserCount());
 *         },
 *     },
 * );
 * ```
 *
 * Keep in mind the callbacks are executed one by one at the time the
 * collectors are collected for the exposition given the Prometheus. The
 * default timeout in Prometheus for a collection job is 10 seconds.   This
 * means the callback completion time should be in the order of milliseconds
 * to avoid having the time of many collectors add up to too much.
 *
 * Like with the Counter the Gauge also supports labels.  When using labels
 * the methods for changing the value of the counter is no longer usable
 * directly on the counter itself, instead a child counter with label values
 * set has to be retrieved with the `.labels()` method.  For example:
 *
 * ```ts
 * const userCount = new Gauge(
 *     "app_user_count",
 *     "Number of users in the app",
 *     {
 *         labels: ["role"],
 *         callback: async function() {
 *             userCount.labels("system").set(await someApi.getSystemUserCount());
 *             userCount.labels("admin").set(await someApi.getAdminUserCount());
 *             userCount.labels("normal").set(await someApi.getNormalUserCount());
 *         }
 *     },
 * );
 * ```
 *
 * When using labels the gauge no longer gets a default value, and this may
 * cause issues with aggregating and querying the gauge values in
 * Prometheus.  This is not an issue with the example shown above as all
 * label combinations used are given a value when the gauge is collected.
 * But if these labeled values were calculated through some other means
 * dynamically there may be cases where values for timeseries that are
 * occasionally used are missing.  When dynamically setting labels it is
 * recommended where possible to initialize all possible combinations of
 * label values that will be used.  This is done by calling `.labels()` for
 * each combination, for example:
 *
 * ```ts
 * for (let role of ["system", "admin", "normal") {
 *     userCount.labels(role);
 * }
 * ```
 *
 * Note that every combination of label values used creates a new time
 * series to be stored and processed.  You should carefully evaluate which
 * labels you actually need as resource usage for a metric increases
 * exponentially with the number of labels used.
 *
 * @extends ValueCollector
 */
export class Gauge extends ValueCollector<GaugeChild> {
	/**
	 * Create optionally labeled gauge
	 *
	 * @param name - Name of the metric.
	 * @param help - Help text for metric.
	 * @param options - options for collector.
	 * @param options.labels -
	 *     Labels for this metric, defaults to no labels.
	 * @param options.register -
	 *     If true registers this collector with the default registry.
	 *     Defaults to true.
	 * @param options.callback -
	 *     Possibly async function that is called when the metric is
	 *     collected.  The collector being collected is passed as the
	 *     argument.
	 */
	constructor(
		name: string,
		help: string,
		options: {
			labels?: string[],
			register?: boolean,
			callback?: (collector: Gauge) => (void | Promise<void>),
		} = {},
	) {
		super("gauge", name, help, options, GaugeChild);
	}

	/**
	 * Increment gague value
	 *
	 * Note: Only works if this is an unlabeled collector.
	 * @param value - number to increment by.
	 */
	inc(value = 1) {
		this._defaultChild!.inc(value);
	}

	/**
	 * Decrement gague value
	 *
	 * Note: Only works if this is an unlabeled collector.
	 * @param value - number to decrease by.
	 */
	dec(value = 1) {
		this._defaultChild!.dec(value);
	}

	/**
	 * Set gague value
	 *
	 * Note: Only works if this is an unlabeled collector.
	 * @param value - number to set gauge to.
	 */
	set(value: number) {
		this._defaultChild!.set(value);
	}

	/**
	 * Set to current Unix epoch time in seconds
	 *
	 * Note: Only works if this is an unlabeled collector.
	 */
	setToCurrentTime() {
		this._defaultChild!.setToCurrentTime();
	}

	/**
	 * Start a timer for setting a duration
	 *
	 * Note: Only works if this is an unlabeled collector.
	 * @returns
	 *     function that when called will set the guage to the duration in
	 *     seconds from when the timer was started
	 */
	startTimer() {
		return this._defaultChild!.startTimer();
	}
}

/**
 * Child Summary holding the sum and count for a single label set.
 */
class SummaryChild {
	protected _sumValues: Map<string, number>;
	protected _countValues: Map<string, number>;
	protected _key: string;

	constructor(collector: Summary, key: string) {
		this._sumValues = collector._sumValues;
		this._countValues = collector._countValues;
		this._key = key;

		this._sumValues.set(key, 0);
		this._countValues.set(key, 0);
	}

	/**
	 * Sum of all observations for label set
	 */
	get sum() {
		return this._sumValues.get(this._key);
	}

	/**
	 * Count of observations for label set
	 */
	get count() {
		return this._countValues.get(this._key);
	}

	/**
	 * Observe a given value and increment matching buckets for label set
	 *
	 * @param value - number to count into summary.
	 */
	observe(value: number) {
		this._sumValues.set(this._key, this._sumValues.get(this._key)! + value);
		this._countValues.set(this._key, this._countValues.get(this._key)! + 1);
	}

	/**
	 * Start a timer for observing a duration for label set
	 *
	 * @returns
	 *     function that when called will store the duration in seconds from
	 *     when the timer was started into the metric.
	 */
	startTimer() {
		let start = process.hrtime.bigint();
		return () => {
			let end = process.hrtime.bigint();
			this.observe(Number(end - start) / 1e9);
		};
	}
}

/**
 * Summary metric
 *
 * Sample observations into a count and sum.  This is useful when you have
 * an operation that reports a metric that you want insight into the rate
 * and average size of values for.  A common case for this is request
 * duration, for example:
 *
 * ```ts
 * const requestDuration = new Summary(
 *     "app_request_duration_seconds",
 *     "Time to process app requests",
 * );
 *
 * async function handleRequest(...) {
 *     const observeDuration = requestDuration.startTimer();
 *     try {
 *         // Do async stuff.
 *     } finally {
 *         observeDuration();
 *     }
 * }
 * ```
 *
 * Note that reporting quantiles is note supported.  This makes the Summary
 * less insightful than the Histogram while using less resources.
 *
 * The `.startTimer()` method provides a convenient interface for adding
 * observed durations to the summary.  Other types of values can be added to
 * a summary with the `.observe()` method.
 *
 * Like with the Counter and Gauge the Summary collector also supports
 * labels.  When using labels the methods for observing values into the
 * summary is no longer usable directly on the counter itself, instead a
 * child summary with label values set has to be retrieved with the
 * `.labels()` method.  For example:
 *
 * ```ts
 * const requestDuration = new Summary(
 *     "app_request_duration_seconds",
 *     "Time to process app requests",
 *     { labels: ["endpoint"] }
 * );
 *
 * async function handleRequest(endpoint, ...) {
 *     const observeDuration = requestDuration.labels(endpoint).startTimer();
 *     try {
 *         // Do async stuff.
 *     } finally {
 *         observeDuration();
 *     }
 * }
 * ```
 *
 * When using labels the summary is no longer initalized with a default
 * value, and this may cause issues with aggregating and querying the
 * summary in Prometheus.  When dynamically setting labels it is recommended
 * where possible to initialize all possible combinations of label values
 * that will be used.  This is done by calling `.labels()` for each
 * combination, for example:
 *
 * ```ts
 * for (let endpoint of ["/status", "/api", ...) {
 *     requestDuration.labels(endpoint);
 * }
 * ```
 *
 * Note that every combination of label values used creates two new time
 * series that need to be stored and processed.  You should carefully
 * evaluate which labels you actually need as resource usage for a metric
 * increases exponentially with the number of labels used.
 */
export class Summary extends LabeledCollector<SummaryChild> {
	_sumValues: Map<string, number>;
	_countValues: Map<string, number>;
	protected _defaultChild: SummaryChild | null;

	/**
	 * Create optionally labeled summary
	 *
	 * @param name - Name of the metric.
	 * @param help - Help text for metric.
	 * @param options - options for collector.
	 * @param options.labels -
	 *     Labels for this metric, defaults to no labels.
	 * @param options.register -
	 *     If true registers this collector with the default registry.
	 *     Defaults to true.
	 * @param options.callback -
	 *     Possibly async function that is called when the metric is
	 *     collected.  The collector being collected is passed as the
	 *     argument.
	 */
	constructor(
		name: string,
		help: string,
		options: {
			labels?: string[],
			register?: boolean,
			callback?: (collector: Summary) => (void | Promise<void>),
		} = {},
	) {
		super("summary", name, help, options, SummaryChild);

		this._sumValues = new Map();
		this._countValues = new Map();
		this._defaultChild = this.metric.labels.length ? null : this.labels({});
	}

	async* collect() {
		if (this.callback) { await this.callback(this); }
		yield {
			metric: this.metric,
			samples: new Map([
				["_sum", this._sumValues],
				["_count", this._countValues],
			]),
		};
	}

	/**
	 * Sum of all observations for label set
	 *
	 * Note: Only available if this is an unlabeled collector.
	 * @type {number}
	 */
	get sum() {
		return this._defaultChild!.sum;
	}

	/**
	 * Count of observations for label set
	 *
	 * Note: Only available if this is an unlabeled collector.
	 * @type {number}
	 */
	get count() {
		return this._defaultChild!.count;
	}

	/**
	 * Observe a given value and increment matching buckets
	 *
	 * Note: Only works if this is an unlabeled collector.
	 * @param value - number to count into histogram buckets.
	 */
	observe(value: number) {
		this._defaultChild!.observe(value);
	}

	/**
	 * Start a timer for observing a duration
	 *
	 * Note: Only works if this is an unlabeled collector.
	 * @returns
	 *     function that when called will store the duration in seconds from
	 *     when the timer was started into the metric.
	 */
	startTimer() {
		return this._defaultChild!.startTimer();
	}

	remove(...labels: LabelValues) {
		let key = super.remove(...labels);
		this._sumValues.delete(key);
		this._countValues.delete(key);
		return key;
	}

	removeAll(labels: Record<string, string>) {
		super.removeAll(labels);
		removeMatchingLabels(this._sumValues, labels);
		removeMatchingLabels(this._countValues, labels);
	}

	clear() {
		super.clear();
		this._sumValues = new Map();
		this._countValues = new Map();
	}
}

function formatValue(value: number) {
	if (value === Infinity) {
		return "+Inf";
	}
	if (value === -Infinity) {
		return "-Inf";
	}
	return value.toString();
}

function formatBucketKey(bucket: number, key: string) {
	return `${key === "" ? "" : `${key},`}le="${formatValue(bucket)}"`;
}

/**
 * Child histogram holding the buckets for a single label set.
 */
class HistogramChild {
	protected _bucketValues: Map<string, number>;
	protected _sumValues: Map<string, number>;
	protected _countValues: Map<string, number>;
	protected _key: string;
	protected _bucketKeys: Map<number, string>;

	constructor(collector: Histogram, key: string) {
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

	/**
	 * Mapping of bucket upper bounds to count of observations for label set
	 */
	get buckets() {
		return new Map(
			[...this._bucketKeys].map(
				([bucket, key]) => [bucket, this._bucketValues.get(key)]
			)
		);
	}

	/**
	 * Sum of all observations for label set
	 */
	get sum() {
		return this._sumValues.get(this._key);
	}

	/**
	 * Count of observations for label set
	 */
	get count() {
		return this._countValues.get(this._key);
	}

	/**
	 * Observe a given value and increment matching buckets for label set
	 *
	 * @param value - number to count into histogram buckets.
	 */
	observe(value: number) {
		for (let [bound, key] of this._bucketKeys) {
			if (value <= bound) {
				this._bucketValues.set(key, this._bucketValues.get(key)! + 1);
			}
		}

		this._sumValues.set(this._key, this._sumValues.get(this._key)! + value);
		this._countValues.set(this._key, this._countValues.get(this._key)! + 1);
	}

	/**
	 * Start a timer for observing a duration for label set
	 *
	 * @returns
	 *     function that when called will store the duration in seconds from
	 *     when the timer was started into the metric.
	 */
	startTimer() {
		let start = process.hrtime.bigint();
		return () => {
			let end = process.hrtime.bigint();
			this.observe(Number(end - start) / 1e9);
		};
	}
}

/**
 * Histogram metric
 *
 * Keeps track of observed values in a set of buckets in a similar vein to a
 * histogram.  This is useful when you have a frequent operation that
 * reports a metric that you want insight into the distribution of values
 * for.  A common case for this is request duration, for example:
 *
 * ```ts
 * const requestDuration = new Histogram(
 *     "app_request_duration_seconds",
 *     "Time to process app requests",
 * );
 *
 * async function handleRequest(...) {
 *     const observeDuration = requestDuration.startTimer();
 *     try {
 *         // Do async stuff.
 *     } finally {
 *         observeDuration();
 *     }
 * }
 * ```
 *
 * The default buckets used for the histogram is suitable for observing
 * HTTP requests durations in seconds, and the `.startTimer()` method
 * provides a convenient interface for adding observed durations to the
 * histogram.  Other types values can be added to a histogram with the
 * `.observe()` method.
 *
 * Like with the Counter and Gauge the Histogram collector also supports
 * labels.  When using labels the methods for observing values into the
 * histogram is no longer usable directly on the counter itself, instead a
 * child histogram with label values set has to be retrieved with the
 * `.labels()` method.  For example:
 *
 * ```ts
 * const requestDuration = new Histogram(
 *     "app_request_duration_seconds",
 *     "Time to process app requests",
 *     { labels: ["endpoint"] }
 * );
 *
 * async function handleRequest(endpoint, ...) {
 *     const observeDuration = requestDuration.labels(endpoint).startTimer();
 *     try {
 *         // Do async stuff.
 *     } finally {
 *         observeDuration();
 *     }
 * }
 * ```
 *
 * When using labels the histogram is no longer initalized with a default value, and this may
 * cause issues with aggregating and querying the histogram in
 * Prometheus.  When dynamically setting labels it is recommended where
 * possible to initialize all possible combinations of label values that
 * will be used.  This is done by calling `.labels()` for each combination,
 * for example:
 *
 * ```ts
 * for (let endpoint of ["/status", "/api", ...) {
 *     requestDuration.labels(endpoint);
 * }
 * ```
 *
 * Note that every combination of label values used creates a new time
 * series for each bucket in the histogram to be stored and processed.
 * (e.g., 10 buckets with 10 possible label combinations will result in 100
 * time series being made.)  You should carefully evaluate which labels you
 * actually need as resource usage for a metric increases exponentially with
 * the number of labels used.
 */
export class Histogram extends LabeledCollector<HistogramChild> {
	_bucketValues: Map<string, number>;
	_sumValues: Map<string, number>;
	_countValues: Map<string, number>;
	_buckets: number[];
	protected _defaultChild: HistogramChild | null;

	/**
	 * Create optionally labeled histogram
	 *
	 * @param name - Name of the metric.
	 * @param help - Help text for metric.
	 * @param options - options for collector.
	 * @param options.buckets -
	 *     Buckets to use for the histogram.  This is an array of inclusive
	 *     upper bounds.  Values observed will increment a bucket if it is
	 *     less than or equal to the upper bound.
	 * @param options.labels -
	 *     Labels for this metric, defaults to no labels.
	 * @param options.register -
	 *     If true registers this collector with the default registry.
	 *     Defaults to true.
	 * @param options.callback -
	 *     Possibly async function that is called when the metric is
	 *     collected.  The collector being collected is passed as the
	 *     argument.
	 */
	constructor(
		name: string,
		help: string,
		options: {
			buckets?: number[],
			labels?: string[],
			register?: boolean,
			callback?: (collector: Histogram) => (void | Promise<void>),
		} = {},
	) {
		// These defaults are taken from the Python Prometheus client
		let {
			buckets = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10, Infinity],
			...rest
		} = options;

		super("histogram", name, help, { ...rest, _reservedLabels: ["le"] }, HistogramChild);

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

	/**
	 * Mapping of bucket upper bounds to count of observations for label set
	 *
	 * Note: Only available if this is an unlabeled collector.
	 */
	get buckets() {
		return this._defaultChild!.buckets;
	}

	/**
	 * Sum of all observations for label set
	 *
	 * Note: Only available if this is an unlabeled collector.
	 */
	get sum() {
		return this._defaultChild!.sum;
	}

	/**
	 * Count of observations for label set
	 *
	 * Note: Only available if this is an unlabeled collector.
	 */
	get count() {
		return this._defaultChild!.count;
	}

	/**
	 * Observe a given value and increment matching buckets
	 *
	 * Note: Only works if this is an unlabeled collector.
	 * @param value - number to count into histogram buckets.
	 */
	observe(value: number) {
		this._defaultChild!.observe(value);
	}

	/**
	 * Start a timer for observing a duration
	 *
	 * Note: Only works if this is an unlabeled collector.
	 * @returns
	 *     function that when called will store the duration in seconds from
	 *     when the timer was started into the metric.
	 */
	startTimer() {
		return this._defaultChild!.startTimer();
	}

	remove(...labels: LabelValues) {
		let key = super.remove(...labels);
		for (let bucket of this._buckets) {
			let bucketKey = formatBucketKey(bucket, key);
			this._bucketValues.delete(bucketKey);
		}
		this._sumValues.delete(key);
		this._countValues.delete(key);
		return key;
	}

	removeAll(labels: Record<string, string>) {
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

	/**
	 * Helper function for generating linear bucket series
	 *
	 * Creates an array of numbers suitable for using as buckets to a
	 * histogram.  The array returned contains `count` numbers starting at
	 * `start` and with each subsequent number being equal to the previous
	 * one plus `width`.
	 *
	 * @param start - Number to start buckets at.
	 * @param width - Distance between ecah bucket.
	 * @param count - Number of buckets.
	 * @returns array of buckets.
	 */
	static linear(start: number, width: number, count: number) {
		let buckets: number[] = [];
		for (let i = 0; i < count; i++) {
			buckets.push(start);
			start += width;
		}
		return buckets;
	}

	/**
	 * Helper function for generating exponential bucket series
	 *
	 * Creates an array of numbers suitable for using as buckets to a
	 * histogram.  The array returned contains `count` numbers starting at
	 * `start` and with each subsequent number being equal to the previous
	 * multiplied with `factor`.
	 *
	 * @param start - Number to start buckets at.
	 * @param factor - Ratio between each bucket.
	 * @param count - Number of buckets.
	 * @returns array of buckets.
	 */
	static exponential(start: number, factor: number, count: number) {
		let buckets: number[] = [];
		for (let i = 0; i < count; i++) {
			buckets.push(start);
			start *= factor;
		}
		return buckets;
	}
}

/**
 * Collection of collectors
 *
 * Provides convienece methods for grouping collectors together and
 * gathering the metrics from all of the contained collectors.  By default
 * collectors are registered and collected from the default registry so
 * using this is usually not necessary.
 *
 * The basic way to use a custom registry is to create Collectors without
 * registring them to the default registry and then adding them to your own
 * registry, for example:
 *
 * ```ts
 * const myRegistry = new CollectorRegistry();
 * const myCounter = new Counter( "a_counter", "A counter.", { register: false });
 * myRegistry.register(myCounter);
 *
 * // In the /metrics HTTP request handler
 * let text = await exposition(myRegistry.collect());
 * ```
 *
 * The same collector can be registered to multiple registries.  This may be
 * used to implement responding with different sets of metrics depending on
 * what is requested.
 */
export class CollectorRegistry {
	collectors: Collector[] = [];

	/**
	 * Collect metrics from all registered collectors.
	 */
	async* collect(): AsyncIterable<CollectorResult> {
		for (let collector of this.collectors) {
			for await (let result of collector.collect()) {
				yield result;
			}
		}
	}

	/**
	 * Add collector to the registry.
	 *
	 * @param collector - Collector to add.
	 */
	register(collector: Collector) {
		let index = this.collectors.lastIndexOf(collector);
		if (index !== -1) {
			throw new Error(
				"Collector is already registered in this registry."
			);
		}

		this.collectors.push(collector);
	}

	/**
	 * Remove collector from the registry.
	 *
	 * @param collector - Collector to remove.
	 */
	unregister(collector: Collector) {
		let index = this.collectors.lastIndexOf(collector);
		if (index === -1) {
			throw new Error(
				"Collector is not registered in this registry."
			);
		}

		this.collectors.splice(index, 1);
	}
}

defaultRegistry = new CollectorRegistry();

function escapeHelp(help: string) {
	return help
		.replace(/\\/g, "\\\\")
		.replace(/\n/g, "\\n")
	;
}

async function* expositionLines(resultsIterator: AsyncIterable<CollectorResult>) {
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

/**
 * Serialize into Prometheus text exposition format
 *
 * Asynchronously collects metrics and converts them into the text based
 * exposition format for Prometheus.  The collectors collected by default is
 * taken from the default registry, but this can be overidden by passing a
 * resultsIterator either from another registry or custom created.
 *
 * The resulting text from calling this method should be served to
 * prometheus, typically by hosting an HTTP server in the app and responding
 * to the /metrics endpoint.  See example below for how this is done with
 * express.js.
 *
 * @example
 * const app = require("express")();
 * async function getMetrics(req, res) {
 *     // By default exposition uses the default collector registry
 *     let text = await exposition();
 *     res.set("Content-Type", exposition.contentType);
 *     res.send(text);
 * }
 * app.get("/metrics", (req, res, next) => getMetrics(req, res).catch(next));
 * app.listen(9100);
 *
 * @param resultsIterator -
 *     Asynchronously itreable of {@link CollectorResult} results to create
 *     exposition for.  Defaults to collecting results from {@link
 *     defaultRegistry}.
 * @returns Prometheus exposition.
 *
 * @property exposition.contentType
 * HTTP Content-Type for the exposition format that's implemented
 */
export async function exposition(resultsIterator = defaultRegistry.collect()) {
	let lines = "";
	for await (let line of expositionLines(resultsIterator)) {
		lines += line;
	}
	return lines;
}
exposition.contentType = "text/plain; version=0.0.4";

/**
 * Serialize CollectorResult into a plain object
 *
 * Converts a {@link CollectorResult} into a plain
 * object form that can be stringified to JSON.
 *
 * @param result -
 *     Result to serialize into plain object form.
 * @param options - Options for controlling the serialization.
 * @param options.addLabels -
 *     Additional labels to append to each value.  This may be used if
 *     multiple sources are combined have the same metric and a qualifier is
 *     needed to make sure the label sets are unique.
 * @param options.metricName - Override metric name of the result.
 * @param options.metricHelp - Override metric help of the result.
 * @returns plain object form of the result.
 */
export function serializeResult(
	result: CollectorResult,
	options: {
		addLabels?: Record<string, string>,
		metricName?: string,
		metricHelp?: string,
	} = {}
) {
	let {
		addLabels,
		metricName = result.metric.name,
		metricHelp = result.metric.help,
		...rest
	} = options;
	for (let name of Object.keys(rest)) {
		throw new Error(`Unrecognized option '${name}'`);
	}

	let samples: Map<string, Map<string, number>>;
	if (!addLabels) {
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
		samples: [...samples].map(
			([name, metricSamples]) => [name, [...metricSamples]] as [string, [string, number][]]
		),
	};
}

/**
 * Deserialize CollectorResult from plain object
 *
 * Reverse counterpart to {@link serializeResult}.
 *
 * @param serializedResult - Previously serialized result object.
 * @returns deserialized result.
 */
export function deserializeResult(
	serializedResult: ReturnType<typeof serializeResult>
): CollectorResult {
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

/**
 * Default collectors provided by this library
 */
export const defaultCollectors = {
	processCpuSecondsTotal: new Gauge(
		"process_cpu_seconds_total",
		"Total user and system CPU time spent in seconds.",
		{
			callback: function(collector) {
				let usage = process.cpuUsage();
				collector.set((usage.user + usage.system) / 1e6);
			},
		},
	),

	processResidentMemoryBytes: new Gauge(
		"process_resident_memory_bytes",
		"Resident memory size in bytes.",
		{
			callback: function(collector) {
				collector.set(process.memoryUsage().rss);
			},
		},
	),

	processHeapBytes: new Gauge(
		"process_heap_bytes",
		"Process heap size in bytes.",
		{
			callback: function(collector) {
				collector.set(process.memoryUsage().heapUsed);
			},
		},
	),

	processStartTimeSeconds: new Gauge(
		"process_start_time_seconds",
		"Start time of the process since unix epoch in seconds."
	),
} as const;

defaultCollectors.processStartTimeSeconds.setToCurrentTime();
