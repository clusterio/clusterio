import { logger as defaultLogger, type Logger } from "./logging.js";
import type { PluginNodeEnvInfo } from "./plugin.js";

type Waiter = {
	resolve: (api: unknown) => void,
	timeout: ReturnType<typeof setTimeout>,
	waiter: string,
};

/**
 * Loads plugins concurrently and lets them wait for each other
 *
 * Owned by the object plugins are loaded into (controller, host or
 * instance).
 */
export class PluginLoader {
	private _apis = new Map<string, unknown>();
	private _waiters = new Map<string, Waiter[]>();
	private _finished = false;

	constructor(
		private _logger: Logger = defaultLogger,
	) {}

	/**
	 * Load plugins concurrently
	 *
	 * Waits for all loads to settle, then throws the error of the first
	 * plugin in the list that failed.
	 *
	 * @param pluginInfos - Plugins to load.
	 * @param loadPlugin - Loads one plugin and returns what its entrypoint returned.
	 */
	async load(pluginInfos: PluginNodeEnvInfo[], loadPlugin: (pluginInfo: PluginNodeEnvInfo) => Promise<unknown>) {
		try {
			const results = await Promise.allSettled(pluginInfos.map(async pluginInfo => {
				this._loaded(pluginInfo.name, await loadPlugin(pluginInfo));
			}));
			const failed = results.find(result => result.status === "rejected");
			if (failed) {
				throw failed.reason;
			}
		} finally {
			this._finish();
		}
	}

	private _loaded(name: string, api: unknown) {
		this._apis.set(name, api);
		for (const entry of this._waiters.get(name) ?? []) {
			clearTimeout(entry.timeout);
			entry.resolve(api);
		}
		this._waiters.delete(name);
	}

	private _finish() {
		this._finished = true;
		for (const [name, entries] of this._waiters) {
			for (const entry of entries) {
				clearTimeout(entry.timeout);
				this._warnNotLoaded(entry.waiter, name);
				entry.resolve(undefined);
			}
		}
		this._waiters.clear();
	}

	/**
	 * Wait for a plugin to load
	 *
	 * @param waiter - Name of the plugin waiting, used in warnings.
	 * @param name - Name of the plugin to wait for.
	 * @param timeoutMs - Time to wait before giving up.
	 * @returns
	 *     What the plugin's entrypoint returned, or undefined with a
	 *     warning logged if it did not load.
	 */
	waitFor<T = unknown>(waiter: string, name: string, timeoutMs = 30_000): Promise<T | undefined> {
		if (this._apis.has(name)) {
			return Promise.resolve(this._apis.get(name) as T);
		}
		if (this._finished) {
			this._warnNotLoaded(waiter, name);
			return Promise.resolve(undefined);
		}

		return new Promise(resolve => {
			const entry: Waiter = {
				resolve: resolve as (api: unknown) => void,
				waiter,
				timeout: setTimeout(() => {
					const entries = this._waiters.get(name)!;
					entries.splice(entries.indexOf(entry), 1);
					this._logger.warn(`Plugin ${waiter} timed out after ${timeoutMs}ms waiting for plugin ${name}`);
					resolve(undefined);
				}, timeoutMs),
			};
			let entries = this._waiters.get(name);
			if (!entries) {
				entries = [];
				this._waiters.set(name, entries);
			}
			entries.push(entry);
		});
	}

	private _warnNotLoaded(waiter: string, name: string) {
		this._logger.warn(`Plugin ${waiter} waited for plugin ${name} which is not loaded`);
	}
}
