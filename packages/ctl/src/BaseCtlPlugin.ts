import * as lib from "@clusterio/lib";

export type CtlPluginContext = lib.PluginLoadContext<{
	hooks: CtlHooks
}>;

/**
 * Collection of clusterioctl plugin hooks
 */
export class CtlHooks {
	constructor(logger: lib.Logger) {
		this.addCommands = new lib.AsyncHook(logger);
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

/**
 * Base class for clusterioctl plugins
 *
 * Ctl plugins are subclasses of this class which get instantiated by
 * clusterioctl in order to extend its functionallity.  To be discovered the
 * class must be exported under the name `CtlPlugin` in the module
 * specified by the `ctlEntrypoint` in the plugin's `plugin` export.
 */
export default class BaseCtlPlugin {
	constructor(
		/**
		 * The plugin's own info module
		 */
		public info: lib.PluginNodeEnvInfo,
		public logger: lib.Logger,
		hooks: CtlHooks,
	) {
		const attach = <Args extends unknown[], Return>(
			hook: lib.AsyncHook<Args, Return>,
			fn?: lib.HookHandler<Args, Return>,
		) => {
			if (fn) {
				hook.attach(info.name, fn.bind(this));
			}
		};

		attach(hooks.addCommands, this.addCommands);
	}

	static fromContext(context: CtlPluginContext) {
		return new this(context.plugin, context.logger, context.hooks);
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

	async addCommands(rootCommand: lib.CommandTree) { }
}
