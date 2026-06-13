import { logger } from "./logging";
import * as libHelpers from "./helpers";

export type HookHandler<Args extends unknown[], Result = void> = (...args: Args) => Result | Promise<Result>;

export class AsyncHook<
	Args extends unknown[],
	Result = void,
> {
	private static readonly _timeoutToken = Symbol("timeout");
	private _handlers = new Map<string, HookHandler<Args, Result>>();

	constructor(
		private _logger = logger,
		private _timeoutMs = 15_000,
	) { }

	get size() {
		return this._handlers.size;
	}

	/**
	 * Stable event listener reference bound to this hook instance.
	 *
	 * This function is pre-bound and guaranteed to remain referentially stable
	 * for the lifetime of the hook instance. It can safely be passed directly
	 * into event emitters (e.g. EventEmitter.on / off) without losing context
	 * or requiring re-binding.
	 *
	 * Example:
	 * `eventEmitter.on("change", hook.listener);`
	 */
	readonly listener = this.invoke.bind(this);

	/**
	 * Attach a handler to this hook.
	 *
	 * An error is thrown if another handler with the same name is already attached.
	 */
	attach(
		name: string,
		handler: HookHandler<Args, Result>,
	) {
		if (this._handlers.has(name)) {
			throw new Error(`Handler with name ${name} is already attached`);
		}
		this._handlers.set(name, handler);
	}

	/**
	 * Remove a previously attached handler.
	 *
	 * If no handler exists, then no action is performed.
	 */
	detach(name: string) {
		this._handlers.delete(name);
	}

	/**
	 * Remove all attached handlers.
	 */
	clear() {
		this._handlers.clear();
	}

	private async _invokeHandler(
		name: string,
		handler: HookHandler<Args, Result>,
		args: Args,
	): Promise<Result | undefined> {
		try {
			const result = await libHelpers.timeout<
				Result | typeof AsyncHook._timeoutToken
			>(
				Promise.resolve(handler(...args)),
				this._timeoutMs,
				AsyncHook._timeoutToken,
			);

			if (result === AsyncHook._timeoutToken) {
				throw new Error(`Hook ${name} timed out after ${this._timeoutMs}ms`);
			}

			return result;

		} catch (err: any) {
			this._logger.error(`Ignoring error in hook "${name}":\n${err?.stack ?? err}`);
			return undefined;
		}
	}

	/**
	 * Invoke all handlers attached to this hook.
	 *
	 * Any return values are discarded.
	 */
	async invoke(...args: Args): Promise<void> {
		await Promise.all(
			[...this._handlers.entries()].map(
				([name, handler]) => this._invokeHandler(name, handler, args)
			)
		);
	}

	/**
	 * Invoke all handlers attached to this hook.
	 *
	 * Returns all successful results.
	 */
	async collect(...args: Args): Promise<Result[]> {
		const results = await Promise.all(
			[...this._handlers.entries()].map(
				([name, handler]) => this._invokeHandler(name, handler, args)
			)
		);

		return results.filter(
			(result): result is Awaited<Result> => result !== undefined
		);
	}
}
