/**
 * Helper class for implementing the exponential backoff algorithm
 *
 * Provides a convenient interface for implementing an exponential backoff
 * when reconnecting or resending in a distributed network.
 *
 * Once instantiated the delay method will return the next interval to wait
 * for in milliseconds before making another attempt.  For each attempt the
 * delay chosen is a random value between 0 and the current maximum delay
 * wwhich starts at a value of 2 * `base` and doubles for ever attempt up to
 * the passed value of `max`.  The value for the delay will reset back to
 * `base` if more time than the value for `reset` has passed between two
 * invocations of delay.
 */
export default class ExponentialBackoff {
	/**
	 * Base delay in seconds.  The first delay will on average be this
	 * long, but can be anywhere between 0 and 2 times this value.
	 */
	base = 1;
	/**
	 * Maximum delay in seconds.  A delay will not take more than this
	 * value.
	 */
	max = 60;
	/**
	 * Time in seconds between two invocations of delay which will cause
	 * it to start over with `base` instead of doubling.
	 */
	reset: number;

	private _exp = 0;
	private _lastInvocationTime = Date.now();

	/**
	 * Construct ExponentialBackoff helper
	 *
	 * The options passed may also be modified on the instance at runtime.
	 *
	 * @param options -
	 *     Options for this exponential backoff helper
	 * @param [options.base=1] -
	 *     Base delay in seconds.  The first delay will on average be this
	 *     long, but can be anywhere between 0 and 2 times this value.
	 * @param [options.max=60] -
	 *     Maximum delay in seconds.  A delay will not take more than this
	 *     value.
	 * @param [options.reset=2*max] -
	 *     Time in seconds between two invocations of delay which will cause
	 *     it to start over with `base` instead of doubling.
	 */
	constructor(options: { base?: number, max?: number, reset?: number } = {}) {
		this.base = options.base || 1;
		this.max = options.max || 60;
		this.reset = options.reset || 2 * this.max;
	}

	/**
	 * Compute the next delay to wait
	 *
	 * Returns the next delay to wait according to the exponential backoff
	 * algorithm.  This is a value between 0 and min(2 * options.base *
	 * 2<sup>retries</sup>, optinos.max).
	 *
	 * @returns time in milliseconds to wait.
	 */
	delay() {
		let invocationTime = Date.now();
		let interval = (invocationTime - this._lastInvocationTime) / 1000;
		this._lastInvocationTime = invocationTime;

		if (interval > this.reset) {
			this._exp = 0;
		}

		this._exp = Math.min(this._exp + 1, Math.log2(this.max));
		return Math.random() * this.base * 2 ** this._exp * 1000;
	}
}
