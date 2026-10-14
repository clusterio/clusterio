import { PluginError } from "./errors.js";

export type SyncHookHandler<Value> = (value: Value) => Value;

/**
 * Hook that passes a value through each attached handler in turn.
 *
 * Handlers run synchronously in the order they were attached, for places
 * that can't wait on a promise such as the Config constructor.
 */
export class SyncHook<Value> {
	private _handlers = new Map<string, SyncHookHandler<Value>>();

	get size() {
		return this._handlers.size;
	}

	get attached() {
		return this._handlers.keys();
	}

	/**
	 * Attach a handler to this hook.
	 *
	 * An error is thrown if another handler with the same name is already attached.
	 */
	attach(name: string, handler: SyncHookHandler<Value>) {
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

	/**
	 * Pass a value through all attached handlers.
	 *
	 * Each handler gets the value returned by the one before it. Errors are
	 * rethrown as a PluginError named after the handler that threw.
	 *
	 * @param value - Value given to the first handler.
	 * @returns Value returned by the last handler.
	 */
	reduce(value: Value) {
		for (const [name, handler] of this._handlers) {
			try {
				value = handler(value);
			} catch (err: any) {
				throw new PluginError(name, err instanceof Error ? err : new Error(String(err)));
			}
		}
		return value;
	}
}
