#!/usr/bin/env node

/**
 * Command line interface for controlling a Clusterio cluster
 * @module ctl/ctl
 */
"use strict";
const fs = require("fs-extra");
const yargs = require("yargs");
const version = require("./package").version;
const setBlocking = require("set-blocking");

const libLink = require("@clusterio/lib/link");
const libData = require("@clusterio/lib/data");
const libErrors = require("@clusterio/lib/errors");
const libConfig = require("@clusterio/lib/config");
const libPlugin = require("@clusterio/lib/plugin");
const libPluginLoader = require("@clusterio/lib/plugin_loader");
const libCommand = require("@clusterio/lib/command");
const libSharedCommands = require("@clusterio/lib/shared_commands");
const { ConsoleTransport, levels, logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");

const commands = require("./src/commands");


/**
 * Connector for control connection to controller
 * @private
 */
class ControlConnector extends libLink.WebSocketClientConnector {
	constructor(url, maxReconnectDelay, tlsCa, token) {
		super(url, maxReconnectDelay, tlsCa);
		this._token = token;
	}

	register() {
		logger.verbose("Connector | registering control");
		this.sendHandshake(new libData.MessageRegisterControl(new libData.RegisterControlData(
			this._token,
			"clusterioctl",
			version,
		)));
	}
}

/**
 * Handles running the control
 *
 * Connects to the controller over WebSocket and sends commands to it.
 * @static
 */
class Control extends libLink.Link {
	constructor(connector, controlConfig, tlsCa, controlPlugins) {
		super(connector);

		/**
		 * Control config used for connecting to the controller.
		 * @type {module:lib/config.ControlConfig}
		 */
		this.config = controlConfig;
		/**
		 * Certificate authority used to validate TLS connections to the controller.
		 * @type {?string}
		 */
		this.tlsCa = tlsCa;
		/**
		 * Mapping of plugin names to their instance for loaded plugins.
		 * @type {Map<string, module:lib/plugin.BaseControlPlugin>}
		 */
		this.plugins = controlPlugins;

		/**
		 * Keep the control connection alive after the command completes.
		 * @type {boolean}
		 */
		this.keepOpen = false;

		this.register(libData.LogMessageEvent, this.handleLogMessageEvent.bind(this));
		this.register(libData.DebugWsMessageEvent, this.handleDebugWsMessageEvent.bind(this));
	}

	async setLogSubscriptions({
		all = false,
		controller = false,
		hostIds = [],
		instanceIds = [],
		maxLevel = null,
	}) {
		await this.send(new libData.LogSetSubscriptionsRequest(
			all, controller, hostIds, instanceIds, maxLevel,
		));
	}

	async handleLogMessageEvent(event) {
		logger.log(event.info);
	}

	async handleDebugWsMessageEvent(event) {
		// eslint-disable-next-line no-console
		console.log("WS", event.direction, event.content);
	}

	async shutdown() {
		try {
			await this.connector.disconnect();
		} catch (err) {
			if (!(err instanceof libErrors.SessionLost)) {
				throw err;
			}
		}
	}
}

async function loadPlugins(pluginList) {
	let pluginInfos = await libPluginLoader.loadPluginInfos(pluginList);
	libConfig.registerPluginConfigGroups(pluginInfos);
	libConfig.finalizeConfigs();

	let controlPlugins = new Map();
	for (let pluginInfo of pluginInfos) {
		if (!pluginInfo.controlEntrypoint) {
			continue;
		}

		let ControlPluginClass = await libPluginLoader.loadControlPluginClass(pluginInfo);
		let controlPlugin = new ControlPluginClass(pluginInfo, logger);
		controlPlugins.set(pluginInfo.name, controlPlugin);
		await controlPlugin.init();
	}
	return controlPlugins;
}

async function startControl() {
	yargs
		.scriptName("clusterioctl")
		.usage("$0 <command> [options]")
		.option("log-level", {
			nargs: 1,
			describe: "Log level to print to stderr",
			default: "server",
			choices: Object.keys(levels),
			type: "string",
		})
		.option("config", {
			nargs: 1,
			describe: "config file to get credentails from",
			default: "config-control.json",
			defaultDescription: "auto",
			type: "string",
		})
		.option("plugin-list", {
			nargs: 1,
			describe: "File containing list of plugins available with their install path",
			default: "plugin-list.json",
			type: "string",
		})
		.command("plugin", "Manage available plugins", libSharedCommands.pluginCommand)
		.command("control-config", "Manage Control config", libSharedCommands.configCommand)
		.wrap(yargs.terminalWidth())
		.help(false) // Disable help to avoid triggering it on the first parse.
	;

	// Parse the args first to get the configured plugin list.
	let args = yargs.parse();

	// Log stream for the ctl session.
	logger.add(new ConsoleTransport({
		errorLevels: Object.keys(levels),
		level: args.logLevel,
		format: new libLoggingUtils.TerminalFormat(),
	}));
	libLoggingUtils.handleUnhandledErrors(logger);

	logger.verbose(`Loading available plugins from ${args.pluginList}`);
	let pluginList = new Map();
	try {
		pluginList = new Map(JSON.parse(await fs.readFile(args.pluginList)));
	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	// If the command is plugin management we don't try to load plugins
	if (args._[0] === "plugin") {
		await libSharedCommands.handlePluginCommand(args, pluginList, args.pluginList);
		return;
	}

	logger.verbose("Loading Plugins");
	let controlPlugins = await loadPlugins(pluginList);

	// Add all cluster management commands including ones from plugins
	let rootCommands = await commands.registerCommands(controlPlugins, yargs);

	// Reparse after commands have been added with help and strict checking.
	args = yargs
		.help()
		.strict()
		.parse()
	;

	logger.verbose(`Loading config from ${args.config}`);
	let controlConfig = new libConfig.ControlConfig("control");
	try {
		await controlConfig.load(JSON.parse(await fs.readFile(args.config)));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.verbose("Config not found, initializing new config");
			await controlConfig.init();

		} else {
			throw new libErrors.StartupError(`Failed to load ${args.config}: ${err.message}`);
		}
	}

	if (args._.length === 0) {
		yargs.showHelp();
		yargs.exit();
	}

	// Handle the control-config command before trying to connect.
	if (args._[0] === "control-config") {
		await libSharedCommands.handleConfigCommand(args, controlConfig, args.config);
		return;
	}

	// Determine which command is being executed.
	let commandPath = [...args._];
	let targetCommand = rootCommands;
	while (commandPath.length && targetCommand instanceof libCommand.CommandTree) {
		targetCommand = targetCommand.get(commandPath.shift());
	}

	// The remaining commands require connecting to the controller.
	if (!controlConfig.get("control.controller_url") || !controlConfig.get("control.controller_token")) {
		logger.error("Missing URL and/or token to connect with.  See README.md for setting up access.");
		process.exitCode = 1;
		return;
	}

	let tlsCa = null;
	let tlsCaPath = controlConfig.get("control.tls_ca");
	if (tlsCaPath) {
		tlsCa = await fs.readFile(tlsCaPath);
	}

	let controlConnector = new ControlConnector(
		controlConfig.get("control.controller_url"),
		controlConfig.get("control.max_reconnect_delay"),
		tlsCa,
		controlConfig.get("control.controller_token")
	);
	let control = new Control(controlConnector, controlConfig, tlsCa, controlPlugins);
	try {
		await controlConnector.connect();
	} catch (err) {
		if (err instanceof libErrors.AuthenticationFailed) {
			throw new libErrors.StartupError(err.message);
		}
		throw err;
	}

	process.on("SIGINT", () => {
		logger.info("Caught interrupt signal, closing connection");
		control.shutdown().catch(err => {
			setBlocking(true);
			logger.error(err.stack);
			// eslint-disable-next-line node/no-process-exit
			process.exit(1);
		});
	});

	try {
		await targetCommand.run(args, control);

	} catch (err) {
		control.keepOpen = false;
		if (err instanceof libErrors.CommandError) {
			logger.error(`Error running command: ${err.message}`);
			process.exitCode = 1;

		} else if (err instanceof libErrors.RequestError) {
			logger.error(`Error sending request:\n${err.stack}`);
			process.exitCode = 1;

		} else {
			throw err;
		}

	} finally {
		if (!control.keepOpen) {
			await control.shutdown();
		}
	}
}

module.exports = {
	Control,
};


if (module === require.main) {
	// eslint-disable-next-line no-console
	console.warn(`
+==========================================================+
I WARNING:  This is the development branch for the 2.0     I
I           version of clusterio.  Expect things to break. I
+==========================================================+
`
	);
	startControl().catch(err => {
		if (!(err instanceof libErrors.StartupError)) {
			logger.fatal(`
+------------------------------------------------------------+
| Unexpected error occured while starting control, please    |
| report it to https://github.com/clusterio/clusterio/issues |
+------------------------------------------------------------+
${err.stack}`
			);
		} else {
			logger.error(`
+---------------------------------+
| Unable to to start clusterioctl |
+---------------------------------+
${err.stack}`
			);
		}

		process.exitCode = 1;
	});
}
