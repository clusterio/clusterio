#!/usr/bin/env node

/**
 * Command line interface for controlling a Clusterio cluster
 * @module ctl/ctl
 */
import fs from "fs-extra";
import yargs from "yargs";
import path from "path";
import { version } from "./package.json";
import setBlocking from "set-blocking";
import { strict as assert } from "assert";

// Reduce startup time by lazy compiling schemas.
(global as any).lazySchemaCompilation = true;
import * as lib from "@clusterio/lib";
import { ConsoleTransport, levels, logger } from "@clusterio/lib";

import * as commands from "./src/commands";
import BaseCtlPlugin from "./src/BaseCtlPlugin";


/**
 * Connector for control connection to controller
 * @private
 */
class ControlConnector extends lib.WebSocketClientConnector {
	private _token: string;

	constructor(url: string, maxReconnectDelay: number, tlsCa: string | undefined, token: string) {
		super(url, maxReconnectDelay, tlsCa);
		this._token = token;
	}

	register() {
		logger.verbose("Connector | registering control");
		this.sendHandshake(
			new lib.MessageRegisterControl(
				new lib.RegisterControlData(
					this._token,
					"clusterioctl",
					version,
				)
			)
		);
	}
}

/**
 * Handles running the control
 *
 * Connects to the controller over WebSocket and sends commands to it.
 * @static
 */
export class Control extends lib.Link {
	/** Control config used for connecting to the controller. */
	config: lib.ControlConfig;
	/** Certificate authority used to validate TLS connections to the controller. */
	tlsCa?: string;
	/** Mapping of plugin names to their instance for loaded plugins. */
	plugins: Map<string, BaseCtlPlugin>;
	/** Keep the control connection alive after the command completes. */
	keepOpen = false;

	constructor(
		connector: ControlConnector,
		controlConfig: lib.ControlConfig,
		tlsCa: string | undefined,
		ctlPlugins: Map<string, BaseCtlPlugin>
	) {
		super(connector);
		this.config = controlConfig;
		this.tlsCa = tlsCa;
		this.plugins = ctlPlugins;

		this.handle(lib.LogMessageEvent, this.handleLogMessageEvent.bind(this));
		this.handle(lib.DebugWsMessageEvent, this.handleDebugWsMessageEvent.bind(this));
	}

	async setLogSubscriptions({
		all = false,
		controller = false,
		hostIds = [] as number[],
		instanceIds = [] as number[],
		maxLevel = undefined as keyof typeof levels | undefined,
	}) {
		await this.send(
			new lib.LogSetSubscriptionsRequest(
				all, controller, hostIds, instanceIds, maxLevel,
			)
		);
	}

	async handleLogMessageEvent(event: lib.LogMessageEvent) {
		logger.log(event.info as any);
	}

	async handleDebugWsMessageEvent(event: lib.DebugWsMessageEvent) {
		// eslint-disable-next-line no-console
		console.log("WS", event.direction, event.content);
	}

	async shutdown() {
		try {
			await (this.connector as ControlConnector).disconnect();
		} catch (err) {
			if (!(err instanceof lib.SessionLost)) {
				throw err;
			}
		}
	}
}

async function loadPlugins(pluginList: Map<string, string>) {
	let pluginInfos = await lib.loadPluginInfos(pluginList);
	lib.registerPluginMessages(pluginInfos);
	lib.registerPluginConfigGroups(pluginInfos);
	lib.finalizeConfigs();

	let ctlPlugins = new Map<string, BaseCtlPlugin>();
	for (let pluginInfo of pluginInfos) {
		if (!pluginInfo.ctlEntrypoint) {
			continue;
		}

		let CtlPlugin = await lib.loadPluginClass(
			pluginInfo.name,
			path.posix.join(pluginInfo.requirePath, pluginInfo.ctlEntrypoint),
			"CtlPlugin",
			BaseCtlPlugin,
		);
		let ctlPlugin = new CtlPlugin(pluginInfo, logger);
		ctlPlugins.set(pluginInfo.name, ctlPlugin);
		await ctlPlugin.init();
	}
	return ctlPlugins;
}

interface CtlArguments {
	[index: string]: unknown;
	$0: string,
	_: (string | number)[],
	logLevel: keyof typeof levels,
	config: string,
	pluginList: string,
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
		.command("plugin", "Manage available plugins", lib.pluginCommand)
		.command("control-config", "Manage Control config", lib.configCommand)
		.wrap(yargs.terminalWidth())
		.help(false) // Disable help to avoid triggering it on the first parse.
	;

	// Parse the args first to get the configured plugin list.
	// eslint-disable-next-line node/no-sync
	let args = yargs.parseSync() as CtlArguments;

	// Log stream for the ctl session.
	logger.add(
		new ConsoleTransport({
			errorLevels: Object.keys(levels),
			level: args.logLevel,
			format: new lib.TerminalFormat(),
		})
	);
	lib.handleUnhandledErrors();

	logger.verbose(`Loading available plugins from ${args.pluginList}`);
	let pluginList = new Map();
	try {
		pluginList = new Map(JSON.parse(await fs.readFile(args.pluginList, "utf8")));
	} catch (err: any) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	// If the command is plugin management we don't try to load plugins
	if (args._[0] === "plugin") {
		await lib.handlePluginCommand(args, pluginList, args.pluginList);
		return;
	}

	logger.verbose("Loading Plugins");
	let ctlPlugins = await loadPlugins(pluginList);

	// Add all cluster management commands including ones from plugins
	let rootCommands = await commands.registerCommands(ctlPlugins, yargs);

	// Reparse after commands have been added with help and strict checking.
	args = yargs
		.help()
		.strict()
		.parse() as CtlArguments
	;

	logger.verbose(`Loading config from ${args.config}`);
	let controlConfig;
	try {
		const jsonConfig = JSON.parse(await fs.readFile(args.config, "utf8"));
		controlConfig = lib.ControlConfig.fromJSON(jsonConfig, "control");

	} catch (err: any) {
		if (err.code === "ENOENT") {
			logger.verbose("Config not found, initializing new config");
			controlConfig = new lib.ControlConfig("control");

		} else {
			throw new lib.StartupError(`Failed to load ${args.config}: ${err.message}`);
		}
	}

	if (args._.length === 0) {
		yargs.showHelp();
		yargs.exit(1, undefined as unknown as Error); // Type definition file is wrong.
	}

	// Handle the control-config command before trying to connect.
	if (args._[0] === "control-config") {
		await lib.handleConfigCommand(args, controlConfig, args.config);
		return;
	}

	// Determine which command is being executed.
	let commandPath = [...args._] as string[];
	let targetCommand: lib.CommandTree | lib.Command = rootCommands;
	while (commandPath.length && targetCommand instanceof lib.CommandTree) {
		targetCommand = targetCommand.get(commandPath.shift()!)!;
	}
	assert(targetCommand instanceof lib.Command);

	// The remaining commands require connecting to the controller.
	if (!controlConfig.get("control.controller_url") || !controlConfig.get("control.controller_token")) {
		logger.error("Missing URL and/or token to connect with.  See README.md for setting up access.");
		process.exitCode = 1;
		return;
	}

	let tlsCa: string | undefined;
	let tlsCaPath = controlConfig.get("control.tls_ca") as string | null;
	if (tlsCaPath) {
		tlsCa = await fs.readFile(tlsCaPath, "utf8");
	}

	let controlConnector = new ControlConnector(
		controlConfig.get("control.controller_url") as string,
		controlConfig.get("control.max_reconnect_delay") as number,
		tlsCa,
		controlConfig.get("control.controller_token") as string,
	);
	let control = new Control(controlConnector, controlConfig, tlsCa, ctlPlugins);
	try {
		await controlConnector.connect();
	} catch (err) {
		if (err instanceof lib.AuthenticationFailed) {
			throw new lib.StartupError(err.message);
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
		if (err instanceof lib.CommandError) {
			logger.error(`Error running command: ${err.message}`);
			process.exitCode = 1;

		} else if (err instanceof lib.RequestError) {
			if (err.stack) {
				logger.error(`Error sending request:\n${err.stack}`);
			} else {
				logger.error(`Error sending request: ${err.message}`);
			}
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

export function bootstrap() {
	// eslint-disable-next-line no-console
	console.warn(`
+==========================================================+
I WARNING:  This is the development branch for the 2.0     I
I           version of clusterio.  Expect things to break. I
+==========================================================+
`
	);
	startControl().catch(err => {
		if (err.errors) {
			logger.fatal(JSON.stringify(err.errors, null, "\t"));
		}
		if (!(err instanceof lib.StartupError)) {
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

if (module === require.main) {
	bootstrap();
}
