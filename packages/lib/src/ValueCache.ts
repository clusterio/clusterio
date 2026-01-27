
/**
 * Represents an async function which can fetch a value for a ValueCache
 */
export interface ValueCacheFetch<T> {
	(): Promise<T>;
}

/**
 * In-memory single value cache
 *
 * Stores the last time a value was fetched and measures staleness
 * Concurrent calls will share the same in-flight fetch
 */
export default class ValueCache<T> {
	private ongoingFetch: Promise<T> | null = null;
	private timestamp: number | null = null;
	private value: T | null = null; // Only valid when timestamp is not null

	/**
	 * Create a new in memory single value cache
	 *
	 * @param fetch A function that fetches and returns a fresh value
	 */
	constructor(
		private readonly fetch: ValueCacheFetch<T>,
	) {}

	/**
	 * Get the cached value, will fetch a fresh value if stale or missing
	 *
	 * @param maxAgeMs Maximum allowed cache age in milliseconds.
	 *                 Defaults to 0, meaning it will always fetch a new value.
	 * @throws TypeError if maxAgeMs is invalid
	 * @throws Propagates errors from underlying fetch method
	 */
	get(maxAgeMs: number = 0): Promise<T> {
		if (maxAgeMs < 0) {
			throw new TypeError("maxAgeMs must be a non-negative number");
		}

		const now = Date.now();

		if (this.timestamp && now - this.timestamp < maxAgeMs) {
			return Promise.resolve(this.value as T);
		}

		if (this.ongoingFetch) {
			return this.ongoingFetch;
		}

		this.ongoingFetch = this.fetch()
			.then(value => {
				this.timestamp = Date.now();
				this.value = value;
				return value;
			})
			.finally(() => {
				this.ongoingFetch = null;
			});

		return this.ongoingFetch;
	}
}
