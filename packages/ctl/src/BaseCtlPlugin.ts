import * as lib from "@clusterio/lib";

export type CtlPluginContext = lib.PluginLoadContext<{
	hooks: CtlHooks
}>;

/**
 * Collection of clusterioctl plugin hooks
 */
export class CtlHooks extends lib.AsyncHookCollection {
	constructor(logger: lib.Logger) {
		super(logger);
		this.addCommands = this.newHook();
	}

	/**
	 * Called to add commands to the command line interface.
	 *
	 * Invoked by clusterioctl to let plugins add commands.  `rootCommand` is
	 * the top level command node which the plugin should add its own {@link
	 * CommandTree} to.
	 *
	 * @param rootCommand -
	 *     Root of the clusterioctl command tree.
	 */
	readonly addCommands: lib.AsyncHook<[rootCommand: lib.CommandTree]>;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface BaseCtlPlugin {
	addCommands?(rootCommand: lib.CommandTree): Promise<void>;
}

/**
 * Base class for clusterioctl plugins
 *
 * Ctl plugins are subclasses of this class which get instantiated by
 * clusterioctl in order to extend its functionallity.  To be discovered the
 * class must be exported under the name `CtlPlugin` in the module
 * specified by the `ctlEntrypoint` in the plugin's `plugin` export.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class BaseCtlPlugin {
	constructor(
		/**
		 * The plugin's own info module
		 */
		public info: lib.PluginNodeEnvInfo,
		public logger: lib.Logger,
		private hooks: CtlHooks,
	) {
		if (this.addCommands) {
			hooks.addCommands.attach(info.name, this.addCommands.bind(this));
		}
	}

	static fromContext(context: CtlPluginContext) {
		return new this(context.plugin, context.logger, context.hooks);
	}

	detachHooks() {
		this.hooks.detachAll(this.info.name);
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() {}
}
