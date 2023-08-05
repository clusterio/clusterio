/**
 * Helper class for rate limiting actions
 *
 * Provides a simple interface for implementing actions that are rate
 * limited on invocations.
 *
 * @example
 * ```ts
 * const rateLimiter = RateLimiter({
 *     action: () => { console.log("action"); },
 *     maxRate: 1,
 * });
 *
 * for (let i = 0; i < 100; i++) {
 *     rateLimiter.activate();
 *     // Prints action twice to the console, once for the first activation
 *     // and one more time 1 second later for 99 other activations that were
 *     // exceeding the rate limit.
 * }
 * ```
 */
export default class RateLimiter {
	/**
	 * Maximum rate of activations per second.
	 */
	maxRate: number;
	/**
	 * Callback invoked at most `maxRate` per second on activation.
	 */
	action: Function | null;

	private _lastRun = 0;
	private _runTimeout = null;
	private lastProgressBroadcast = Date.now();

	/**
	 * Construct RateLimiter helper
	 *
	 * The options passed may also be modified on the instance at runtime.
	 *
	 * @param options - Options for this rate limiter
	 * @param options.maxRate -
	 *     Maximum rate of activations per second.
	 * @param options.action -
	 *     Callback invoked at maste `maxRate` per second on activation.
	 */
	constructor(options: { maxRate?: number, action?: Function } = {}) {
		this.maxRate = options.maxRate || 1;
		this.action = options.action || null;
	}

	/**
	 * Activate the rate limited action
	 *
	 * Checks if the invocation of the rate limited action now would fall
	 * within the rate limit.  If it is within the limit then the action is
	 * invoked immediatly, otherwise a timeout is registered to invoke the
	 * action at next point in time where it will be within the rate limit.
	 *
	 * @returns true if activation was within the rate limit.
	 */
	activate() {
		let now = Date.now();
		if (now < this._lastRun + 1000 / this.maxRate) {
			if (!this._runTimeout && this.action !== null) {
				this._runTimeout = setTimeout(() => {
					this._runTimeout = null;
					this._lastRun = Date.now();
					this.action();
				}, this._lastRun + 1000 / this.maxRate - now);
			}
			return false;
		}

		// We may end up activating before the timeout does.
		if (this._runTimeout) {
			clearTimeout(this._runTimeout);
			this._runTimeout = null;
		}

		this._lastRun = now;
		if (this.action !== null) {
			this.action();
		}
		return true;
	}

	/**
	 * Cancel pending action
	 *
	 * Cancel pending action invocation.  This is necessary when shutting
	 * down the use of the rate limit as a timeout is registered to invoke
	 * the next action when activated faster than the rate limit allows.
	 */
	cancel() {
		if (this._runTimeout) {
			clearTimeout(this._runTimeout);
		}
	}
}
