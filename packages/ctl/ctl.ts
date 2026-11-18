#!/usr/bin/env node

/**
 * Command line interface for controlling a Clusterio cluster
 * @module ctl/ctl
 */
import fs from "node:fs/promises";
import yargs, { type Argv } from "yargs";
import path from "path";
import packageConfig from "@clusterio/ctl/package.json" with { type: "json" };
import { strict as assert } from "assert";

// Reduce startup time by lazy compiling schemas.
import "./src/set_lazy_schema_compliation.js";
import * as lib from "@clusterio/lib";
import { ConsoleTransport, levels, logger } from "@clusterio/lib";

import * as commands from "./src/commands.js";
import { BaseCtlPlugin, CtlHooks } from "./src/BaseCtlPlugin.js";
import { CommandOutput, outputFormats, type OutputFormat } from "./src/command_ops.js";


/**
 * Connector for control connection to controller
 * @private
 */
class CtlConnector extends lib.WebSocketClientConnector {
	private _token: string;

	constructor(url: string, maxReconnectDelay: number, token: string) {
		super(url, maxReconnectDelay);
		this._token = token;
	}

	register() {
		logger.verbose("Connector | registering control");
		this.sendHandshake(
			new lib.MessageRegisterControl(
				new lib.RegisterControlData(
					this._token,
					packageConfig.version,
				)
			)
		);
	}
}

/**
 * Handles running ctl
 *
 * Connects to the controller over WebSocket and sends commands to it.
 * @static
 */
export class Ctl extends lib.Link {
	/** Ctl config used for connecting to the controller. */
	config: lib.CtlConfig;
	/** Keep the control connection alive after the command completes. */
	keepOpen = false;
	/** Output of the command being run. */
	output = new CommandOutput();

	constructor(
		connector: CtlConnector,
		ctlConfig: lib.CtlConfig,
	) {
		super(connector);
		this.config = ctlConfig;

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
		// Only streaming commands print log events as results, the rest log them to stderr
		if (this.output.streaming) {
			this.output.result(event.info, () => logger.log(event.info as any));
		} else {
			logger.log(event.info as any);
		}
	}

	async handleDebugWsMessageEvent(event: lib.DebugWsMessageEvent) {
		this.output.result(
			{ direction: event.direction, content: event.content },
			// eslint-disable-next-line no-console
			() => console.log("WS", event.direction, event.content),
		);
	}

	async shutdown() {
		try {
			await (this.connector as CtlConnector).disconnect();
		} catch (err) {
			if (!(err instanceof lib.SessionLost)) {
				throw err;
			}
		}
	}
}

async function loadPlugins(pluginList: Map<string, string>, hooks: CtlHooks) {
	let pluginInfos = await lib.loadPluginInfos(pluginList);
	lib.registerPluginMessages(pluginInfos);
	lib.registerPluginPermissions(pluginInfos);
	lib.addPluginConfigFields(pluginInfos);

	const ctlPlugins = new Set<lib.PluginNodeEnvInfo>();
	for (let pluginInfo of pluginInfos) {
		if (!pluginInfo.ctlEntrypoint) {
			continue;
		}

		const context = { hooks, logger, plugin: pluginInfo };
		await lib.loadPlugin(pluginInfo, "ctl", context, "CtlPlugin", BaseCtlPlugin);
		ctlPlugins.add(pluginInfo);
	}

	return ctlPlugins;
}

interface CtlArguments {
	[index: string]: unknown;
	$0: string,
	_: (string | number)[],
	logLevel: keyof typeof levels,
	output: OutputFormat,
	config: string,
	pluginList: string,
	bypassLockFile: boolean,
	createConfig: boolean,
}

interface InitializeParameters {
	args: CtlArguments;
	shouldRun: boolean;
	ctlHooks: CtlHooks;
	rootCommands?: lib.CommandTree;
	ctlConfig?: lib.CtlConfig;
}

export async function initialize(
	argv: string | string[],
	ctlHooks: CtlHooks = new CtlHooks(logger),
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
		.option("output", {
			nargs: 1,
			describe: "Format to print command results in",
			default: "human",
			choices: outputFormats,
			type: "string",
		})
		.option("config", {
			nargs: 1,
			describe: "config file to get credentails from",
			default: "config-ctl.json",
			defaultDescription: "auto",
			type: "string",
		})
		.option("create-config", {
			nargs: 0,
			describe: "Create config file if it does not exist",
			default: false,
			type: "boolean",
		})
		.option("plugin-list", {
			nargs: 1,
			describe: "File containing list of plugins available with their install path",
			default: "plugin-list.json",
			type: "string",
		})
		.option("bypass-lock-file", { hidden: true, type: "boolean", nargs: 0, default: false })
		.command("plugin", "Manage available plugins", lib.pluginCommand)
		.command("config", "Manage ctl config", lib.configCommand)
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

	// Discover and load plugins. ctlHooks.size check exists to allow tests to inject plugins.
	if (ctlHooks.addCommands.size === 0 || args._[0] === "plugin") {
		logger.verbose(`Loading available plugins from ${args.pluginList}`);
		const pluginList = await lib.loadPluginList(args.pluginList);

		// If the command is plugin management we don't try to load plugins
		if (args._[0] === "plugin") {
			await lib.handlePluginCommand(args, pluginList, args.pluginList);
			return { args, ctlHooks, shouldRun: false };
		}

		logger.verbose("Loading Plugins");
		await loadPlugins(pluginList, ctlHooks);
	}

	// Add all commands including from plugins and reparse with help and strict checking.
	const rootCommands = await commands.registerCommands(ctlHooks, parser);
	args = parser
		.help()
		.strict()
		.parse(argv) as CtlArguments
	;

	const [ctlConfig, ctlConfigLock] = await lib.loadConfigFromArgs(
		args,
		lib.CtlConfig,
		"control",
	);

	if (args._.length === 0) {
		parser.showHelp();
		parser.exit(1, undefined as unknown as Error); // Type definition file is wrong.
	}

	// Handle the config command before trying to connect.
	if (args._[0] === "config") {
		await lib.handleConfigCommand(args, ctlConfig, ctlConfigLock);
		return { args, ctlConfig, ctlHooks, rootCommands, shouldRun: false };
	}

	return { args, ctlConfig, ctlHooks, rootCommands, shouldRun: true };
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

/**
 * Run the command selected by args, printing results in the format given by args.output
 */
export async function runCommand(
	args: CtlArguments,
	rootCommands: lib.CommandTree,
	link: lib.Link & { output?: CommandOutput },
) {
	link.output = new CommandOutput(args.output);
	const targetCommand = selectTargetCommand(args, rootCommands);
	await targetCommand.run(args, link);
	link.output.finish();
}

async function startCtl() {
	const {
		args,
		shouldRun,
		rootCommands,
		ctlConfig,
	} = await initialize(process.argv.slice(2));
	if (!shouldRun || !rootCommands || !ctlConfig) {
		return;
	}

	try {
		await connectAndRun(args, rootCommands, ctlConfig);
	} catch (err) {
		if (args.output !== "human") {
			new CommandOutput(args.output).error(err);
		}
		throw err;
	}
}

async function connectAndRun(args: CtlArguments, rootCommands: lib.CommandTree, ctlConfig: lib.CtlConfig) {
	if (!ctlConfig.get("ctl.controller_url") || !ctlConfig.get("ctl.controller_token")) {
		throw new lib.StartupError("Missing URL and/or token to connect with.  See README.md for setting up access.");
	}

	let controlConnector = new CtlConnector(
		ctlConfig.get("ctl.controller_url")!,
		ctlConfig.get("ctl.max_reconnect_delay"),
		ctlConfig.get("ctl.controller_token")!,
	);

	let ctl = new Ctl(controlConnector, ctlConfig);
	try {
		await controlConnector.connect();
	} catch (err) {
		if (err instanceof lib.AuthenticationFailed) {
			throw new lib.StartupError(err.message);
		}
		throw err;
	}

	// Handle interrupts
	process.on("SIGINT", lib.createShutdownGuard(logger, "interrupt", ctl.shutdown.bind(ctl)));
	process.on("SIGTERM", lib.createShutdownGuard(logger, "termination", ctl.shutdown.bind(ctl)));

	try {
		await runCommand(args, rootCommands, ctl);

	} catch (err) {
		ctl.keepOpen = false;
		if (err instanceof lib.CommandError) {
			logger.error(`Error running command: ${err.message}`);

		} else if (err instanceof lib.ClientError || err instanceof lib.UnavailableError) {
			logger.error(`Error sending request: ${err.message}`);

		} else if (err instanceof lib.ServerError) {
			logger.error(`Error sending request:\n${err.stack ?? err.message}`);

		} else {
			throw err;
		}
		if (!ctl.output.human) {
			ctl.output.error(err);
		}
		process.exitCode = 1;

	} finally {
		if (!ctl.keepOpen) {
			await ctl.shutdown();
		}
	}
}

export function bootstrap() {
	startCtl().catch(err => {
		process.exitCode = 1;
		if (err.errors) {
			logger.fatal(JSON.stringify(err.errors, null, "\t"));
		}
		if (!(err instanceof lib.StartupError)) {
			logger.fatal(`
+---------------------------------------------------------------+
| Unexpected error occured while starting clussterioctl, please |
| report it to https://github.com/clusterio/clusterio/issues    |
+---------------------------------------------------------------+
${err.stack}`
			);
		} else {
			logger.fatal(`
+---------------------------------+
| Unable to to start clusterioctl |
+---------------------------------+
${err.stack}`
			);
		}
	});
}

if (import.meta.main) {
	bootstrap();
}
