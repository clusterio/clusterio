import type { CommandTree, Logger, PluginNodeEnvInfo } from "@clusterio/lib";

/**
 * Base class for clusterioctl plugins
 *
 * Ctl plugins are subclasses of this class which get instantiated by
 * clusterioctl in order to extend its functionallity.  To be discovered the
 * class must be exported under the name `CtlPlugin` in the module
 * specified by the `ctlEntrypoint` in the plugin's `plugin` export.
 */
export default class BaseCtlPlugin {
	/**
	 * Logger for this plugin
	 *
	 * Instance of winston Logger for sending log messages from this
	 * plugin.  Supported methods and their corresponding log levels are
	 * `error`, `warn`, `audit`, `info` and `verbose`.
	 */
	logger: Logger;

	constructor(
		/**
		 * The plugin's own info module
		 */
		public info: PluginNodeEnvInfo,
		logger: Logger,
	) {
		this.logger = logger.child({ plugin: this.info.name }) as unknown as Logger;
	}

	/**
	 * Called immediately after the class is instantiated
	 */
	async init() { }

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
	async addCommands(rootCommand: CommandTree) { }
}
