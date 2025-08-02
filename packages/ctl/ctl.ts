#!/usr/bin/env node

/**
 * Command line interface for controlling a Clusterio cluster
 * @module ctl/ctl
 */
import fs from "fs-extra";
import yargs, { type Argv } from "yargs";
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
	lib.addPluginConfigFields(pluginInfos);

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

interface InitializeParameters {
	args: CtlArguments;
	shouldRun: boolean;
	ctlPlugins?: Map<string, BaseCtlPlugin>;
	rootCommands?: lib.CommandTree;
	controlConfig?: lib.ControlConfig;
}

export async function initialize(
	argv: string | string[],
	ctlPlugins?: Map<string, BaseCtlPlugin>,
	noLoggerTransport?: boolean,
): Promise<InitializeParameters> {
	// Build a fresh, isolated yargs parser each time this function is called.
	// If the currently loaded yargs object supports .reset() we use that (older versions),
	// otherwise we fall back to creating a brand-new parser instance by invoking the
	// yargs factory function directly with an empty argv array.  This avoids Mocha’s
	// own CLI flags (or anything else that touched yargs earlier in the same process)
	// from leaking into subsequent parses inside the test runner.
	const parser: Argv = typeof (yargs as any).reset === "function"
		? (yargs as any).reset()
		: (yargs as any)([]);

	parser
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
		.wrap(parser.terminalWidth())
		.help(false) // Disable help to avoid triggering it on the first parse.
	;

	// Parse the args first to get the configured plugin list.
	// eslint-disable-next-line node/no-sync
	let args = parser.parseSync(argv) as CtlArguments;

	// Log stream for the ctl session. Skipped in testing.
	if (!noLoggerTransport) {
		logger.add(
			new ConsoleTransport({
				errorLevels: Object.keys(levels),
				level: args.logLevel,
				format: new lib.TerminalFormat(),
			})
		);
		lib.handleUnhandledErrors();
	}

	// Discover and load plugins. This check exists to allow tests to inject plugins.
	if (!ctlPlugins || args._[0] === "plugin") {
		logger.verbose(`Loading available plugins from ${args.pluginList}`);
		const pluginList = await lib.loadPluginList(args.pluginList);

		// If the command is plugin management we don't try to load plugins
		if (args._[0] === "plugin") {
			await lib.handlePluginCommand(args, pluginList, args.pluginList);
			return { args, shouldRun: false };
		}

		logger.verbose("Loading Plugins");
		ctlPlugins = await loadPlugins(pluginList);
	}

	// Add all commands including from plugins and reparse with help and strict checking.
	const rootCommands = await commands.registerCommands(ctlPlugins, parser);
	args = parser
		.help()
		.strict()
		.parse(argv) as CtlArguments
	;

	let controlConfig;
	const controlConfigPath = args.config;
	logger.verbose(`Loading config from ${controlConfigPath}`);
	try {
		controlConfig = await lib.ControlConfig.fromFile("control", controlConfigPath);

	} catch (err: any) {
		if (err.code === "ENOENT") {
			logger.verbose("Config not found, initializing new config");
			controlConfig = new lib.ControlConfig("control", undefined, controlConfigPath);

		} else {
			throw new lib.StartupError(`Failed to load ${args.config}: ${err.stack ?? err.message ?? err}`);
		}
	}

	if (args._.length === 0) {
		parser.showHelp();
		parser.exit(1, undefined as unknown as Error); // Type definition file is wrong.
	}

	// Handle the control-config command before trying to connect.
	if (args._[0] === "control-config") {
		await lib.handleConfigCommand(args, controlConfig);
		return { args, controlConfig, ctlPlugins, rootCommands, shouldRun: false };
	}

	return { args, controlConfig, ctlPlugins, rootCommands, shouldRun: true };
}

export function selectTargetCommand(args: CtlArguments, rootCommands: lib.CommandTree): lib.Command {
	let commandPath = [...args._] as string[];
	let targetCommand: lib.CommandTree | lib.Command = rootCommands;
	while (commandPath.length && targetCommand instanceof lib.CommandTree) {
		targetCommand = targetCommand.get(commandPath.shift()!)!;
	}
	assert(targetCommand instanceof lib.Command);
	return targetCommand;
}

async function startControl() {
	const {
		args,
		shouldRun,
		ctlPlugins,
		rootCommands,
		controlConfig,
	} = await initialize(process.argv.slice(2));
	if (!shouldRun || !ctlPlugins || !rootCommands || !controlConfig) {
		return;
	}

	if (!controlConfig.get("control.controller_url") || !controlConfig.get("control.controller_token")) {
		logger.error("Missing URL and/or token to connect with.  See README.md for setting up access.");
		process.exitCode = 1;
		return;
	}

	let tlsCa: string | undefined;
	let tlsCaPath = controlConfig.get("control.tls_ca");
	if (tlsCaPath) {
		tlsCa = await fs.readFile(tlsCaPath, "utf8");
	}

	let controlConnector = new ControlConnector(
		controlConfig.get("control.controller_url")!,
		controlConfig.get("control.max_reconnect_delay"),
		tlsCa,
		controlConfig.get("control.controller_token")!,
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

			process.exit(1);
		});
	});

	try {
		const targetCommand = selectTargetCommand(args, rootCommands);
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
