// Shared by node and the web interface, node specifics go in #import_plugin
import importPlugin from "#import_plugin";
import { Config } from "./config/classes.js";
import { ControllerConfig, HostConfig, InstanceConfig } from "./config/definitions.js";
import Role from "./data/Role.js";
import { PluginError } from "./errors.js";
import { logger, type Logger } from "./logging.js";
import type {
	MigrationHooks, PluginClass, PluginDeclaration, PluginLoadContext, PluginNodeEnvInfo, PluginRegistry, PluginType,
} from "./plugin.js";

type Waiter = {
	resolve: (api: unknown) => void,
	timeout: ReturnType<typeof setTimeout>,
	waiter: string,
};

export type PluginLoadOptions<Context extends object, Info extends PluginDeclaration> = {
	/** Entrypoint to load, e.g. controller loads controllerEntrypoint */
	type: PluginType,
	/** Context passed to each plugin, plugin, logger and plugins are added per plugin */
	context: Context | ((pluginInfo: Info) => Context),
	/** Logger for warnings, plugins get a child of it */
	logger: Logger,
	/** All installed plugins, used by checkInstalled */
	installed: Info[],
	/** Plugins to load, used by checkEnabled */
	load: Info[],
	/** Name of the deprecated class export, class exports are not accepted if unset */
	exportName?: string,
	baseClass?: PluginClass<any, any>,
	/** Return failed plugins instead of throwing the first error */
	continueOnError?: boolean,
};

export type PluginLoadResult<Info> = {
	/** What each loaded plugin's entrypoint returned, in load order */
	loaded: Map<Info, unknown>,
	failed: Map<Info, Error>,
};

/**
 * Loads plugins concurrently and lets them wait for each other
 *
 * Created for one load of plugins with {@link PluginLoader.load}.
 */
export class PluginLoader<Context extends object, Info extends PluginDeclaration> {
	private _apis = new Map<string, unknown>();
	private _waiters = new Map<string, Waiter[]>();
	private _installed: Set<string>;
	private _enabled: Set<string>;
	/** Plugins still loading */
	private _pending: Set<string>;

	private constructor(
		private _options: PluginLoadOptions<Context, Info>,
	) {
		this._installed = new Set(_options.installed.map(pluginInfo => pluginInfo.name));
		this._enabled = new Set(_options.load.map(pluginInfo => pluginInfo.name));
		this._pending = new Set(this._enabled);
	}

	/**
	 * Load plugins concurrently
	 *
	 * Waits for all plugins to settle, then throws the error of the first
	 * plugin in the list that failed unless continueOnError is set.
	 * Errors are wrapped in PluginError.
	 *
	 * @param options - What to load and how.
	 * @returns Loaded and failed plugins.
	 */
	static async load<Context extends object, Info extends PluginDeclaration>(
		options: PluginLoadOptions<Context, Info>
	): Promise<PluginLoadResult<Info>> {
		return await new PluginLoader(options)._load();
	}

	private async _load() {
		const results = await Promise.allSettled(this._options.load.map(async pluginInfo => {
			const startedMs = Date.now();
			try {
				const api = await this._loadPlugin(pluginInfo);
				if (this._options.type !== "migration" && pluginInfo[`${this._options.type}Entrypoint`]) {
					this._options.logger.info(`Loaded plugin ${pluginInfo.name} in ${Date.now() - startedMs}ms`);
				}
				this._settle(pluginInfo.name, true, api);
				return api;
			} catch (err) {
				this._settle(pluginInfo.name, false);
				throw err;
			}
		}));

		const loaded = new Map<Info, unknown>();
		const failed = new Map<Info, Error>();
		for (const [index, result] of results.entries()) {
			const pluginInfo = this._options.load[index];
			if (result.status === "fulfilled") {
				loaded.set(pluginInfo, result.value);
			} else {
				failed.set(pluginInfo, result.reason);
			}
		}
		if (failed.size && !this._options.continueOnError) {
			throw failed.values().next().value;
		}
		return { loaded, failed };
	}

	private async _loadPlugin(pluginInfo: Info) {
		const { type, exportName, baseClass } = this._options;
		const entrypoint = pluginInfo[`${type}Entrypoint`];
		if (!entrypoint) {
			return undefined;
		}

		const options = this._options;
		const context = typeof options.context === "function" ? options.context(pluginInfo) : options.context;
		const pluginContext: PluginLoadContext<Context, Info> = {
			...context,
			plugin: pluginInfo,
			logger: options.logger.child({ plugin: pluginInfo.name }),
			plugins: this._registry(pluginInfo.name),
		};

		try {
			const module = await importPlugin(pluginInfo, entrypoint);
			if (typeof module.default === "function") {
				return await module.default(pluginContext) as unknown;
			}

			// migrate: accept plugins which export classes
			if (exportName && baseClass && module[exportName]) {
				pluginContext.logger.warn(`Plugin ${pluginInfo.name} is using deprecated class export`);
				return await loadPluginClass(pluginInfo, pluginContext, module[exportName], exportName, baseClass);
			}

			throw new Error(exportName
				? `Plugin ${pluginInfo.name} must export either a default function or ${exportName} class`
				: `Expected ${type} plugin ${pluginInfo.name} to export a default function`
			);
		} catch (err: any) {
			if (err.code === "InstallationError") {
				throw err;
			}
			throw new PluginError(pluginInfo.name, err);
		}
	}

	private _registry(waiter: string): PluginRegistry {
		return {
			waitFor: (name, timeoutMs) => this._waitFor(waiter, name, timeoutMs),
			checkInstalled: name => this._installed.has(name),
			checkEnabled: name => this._enabled.has(name),
		};
	}

	private _settle(name: string, loaded: boolean, api?: unknown) {
		this._pending.delete(name);
		if (loaded) {
			this._apis.set(name, api);
		}
		for (const entry of this._waiters.get(name) ?? []) {
			clearTimeout(entry.timeout);
			if (!loaded) {
				this._warnNotLoaded(entry.waiter, name);
			}
			entry.resolve(api);
		}
		this._waiters.delete(name);
	}

	private _waitFor<T>(waiter: string, name: string, timeoutMs = 30_000): Promise<T | undefined> {
		if (this._apis.has(name)) {
			return Promise.resolve(this._apis.get(name) as T);
		}
		if (!this._pending.has(name)) {
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
					this._options.logger.warn(
						`Plugin ${waiter} timed out after ${timeoutMs}ms waiting for plugin ${name}`
					);
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
		this._options.logger.warn(`Plugin ${waiter} waited for plugin ${name} which is not loaded`);
	}
}

async function loadPluginClass(
	pluginInfo: PluginDeclaration,
	context: PluginLoadContext<object, any>,
	pluginClass: unknown,
	exportName: string,
	baseClass: PluginClass<any, any>,
) {
	if (typeof pluginClass !== "function") {
		throw new Error(`Expected plugin ${pluginInfo.name} to export a class named ${exportName}`);
	}

	if (!(pluginClass.prototype instanceof baseClass)) {
		throw new Error(`Expected ${exportName} exported from ${pluginInfo.name} to extend ${baseClass.name}`);
	}

	const plugin = (pluginClass as PluginClass<any, any>).fromContext(context);
	try {
		await plugin.init();
	} catch (err) {
		plugin.detachHooks();
		throw err;
	}

	return plugin;
}

/**
 * Load the migration entrypoints of plugins
 *
 * Must be called before configs and roles are loaded for the migrations
 * to run on them. Loaded for every plugin, including those disabled with
 * load_plugin. Also registers the plugin versions written to each config
 * after the migrations run.
 *
 * @param pluginInfos - Plugins to load migrations for.
 */
export async function loadPluginMigrations(pluginInfos: PluginNodeEnvInfo[]) {
	const hooks: MigrationHooks = {
		controllerConfig: ControllerConfig.pluginMigrations,
		hostConfig: HostConfig.pluginMigrations,
		instanceConfig: InstanceConfig.pluginMigrations,
		role: Role.pluginMigrations,
	};

	for (const pluginInfo of pluginInfos) {
		Config.pluginVersions.set(pluginInfo.name, pluginInfo.version);
	}
	await PluginLoader.load({
		type: "migration",
		context: { hooks },
		logger,
		installed: pluginInfos,
		load: pluginInfos,
	});
}
