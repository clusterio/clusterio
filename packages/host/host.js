#!/usr/bin/env node

/**
 * Clusterio host
 *
 * Connects to the controller and hosts Factorio servers that can
 * communicate with the cluster.  It is remotely controlled by {@link
 * module:controller/controller}.
 *
 * @module host/host
 * @author Danielv123, Hornwitser
 * @example
 * npx clusteriohost run
 */
"use strict";
const fs = require("fs-extra");
const path = require("path");
const yargs = require("yargs");
const setBlocking = require("set-blocking");
const version = require("./package").version;
const winston = require("winston");
require("winston-daily-rotate-file");

// internal libraries
const libData = require("@clusterio/lib/data");
const libLink = require("@clusterio/lib/link");
const libPluginLoader = require("@clusterio/lib/plugin_loader");
const libErrors = require("@clusterio/lib/errors");
const libConfig = require("@clusterio/lib/config");
const libSharedCommands = require("@clusterio/lib/shared_commands");
const { ConsoleTransport, FilteredTransport, levels, logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");

const Host = require("./src/Host");


class HostConnector extends libLink.WebSocketClientConnector {
	constructor(hostConfig, tlsCa, pluginInfos) {
		super(
			hostConfig.get("host.controller_url"),
			hostConfig.get("host.max_reconnect_delay"),
			tlsCa
		);
		this.hostConfig = hostConfig;
		this.pluginInfos = pluginInfos;
	}

	register() {
		logger.info("Connector | registering host");
		let plugins = {};
		for (let pluginInfo of this.pluginInfos) {
			plugins[pluginInfo.name] = pluginInfo.version;
		}

		this.sendHandshake(
			new libData.MessageRegisterHost(
				new libData.RegisterHostData(
					this.hostConfig.get("host.controller_token"),
					"Clusterio Host",
					version,
					this.hostConfig.get("host.name"),
					this.hostConfig.get("host.id"),
					this.hostConfig.get("host.public_address"),
					plugins,
				)
			)
		);
	}
}


async function startHost() {
	// argument parsing
	const args = yargs
		.scriptName("host")
		.usage("$0 <command> [options]")
		.option("log-level", {
			nargs: 1,
			describe: "Log level to print to stdout",
			default: "info",
			choices: ["none"].concat(Object.keys(levels)),
			type: "string",
		})
		.option("log-directory", {
			nargs: 1,
			describe: "Directory to place logs in",
			default: "logs",
			type: "string",
		})
		.option("config", {
			nargs: 1,
			describe: "host config file to use",
			default: "config-host.json",
			type: "string",
		})
		.option("plugin-list", {
			nargs: 1,
			describe: "File containing list of plugins available with their install path",
			default: "plugin-list.json",
			type: "string",
		})
		.command("plugin", "Manage available plugins", libSharedCommands.pluginCommand)
		.command("config", "Manage Host config", libSharedCommands.configCommand)
		.command("run", "Run host")
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	logger.add(new winston.transports.DailyRotateFile({
		format: winston.format.json(),
		filename: "host-%DATE%.log",
		utc: true,
		dirname: path.join(args.logDirectory, "host"),
	}));
	if (args.logLevel !== "none") {
		logger.add(new ConsoleTransport({
			level: args.logLevel,
			format: new libLoggingUtils.TerminalFormat(),
			filter: info => info.instance_id === undefined,
		}));
	}
	libLoggingUtils.handleUnhandledErrors(logger);

	let command = args._[0];
	if (command === "run") {
		logger.info(`Starting Clusterio host ${version}`);
	}

	logger.info(`Loading available plugins from ${args.pluginList}`);
	let pluginList = new Map();
	try {
		pluginList = new Map(JSON.parse(await fs.readFile(args.pluginList)));
	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	// If the command is plugin management we don't try to load plugins
	if (command === "plugin") {
		await libSharedCommands.handlePluginCommand(args, pluginList, args.pluginList);
		return;
	}

	logger.info("Loading Plugin info");
	let pluginInfos = await libPluginLoader.loadPluginInfos(pluginList);
	libLink.registerPluginMessages(pluginInfos);
	libConfig.registerPluginConfigGroups(pluginInfos);
	libConfig.finalizeConfigs();

	logger.info(`Loading config from ${args.config}`);
	let hostConfig = new libConfig.HostConfig("host");
	try {
		await hostConfig.load(JSON.parse(await fs.readFile(args.config)));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.info("Config not found, initializing new config");
			await hostConfig.init();

		} else {
			throw new libErrors.StartupError(`Failed to load ${args.config}: ${err.message}`);
		}
	}

	if (command === "config") {
		await libSharedCommands.handleConfigCommand(args, hostConfig, args.config);
		return;
	}

	// If we get here the command was run

	await fs.ensureDir(hostConfig.get("host.instances_directory"));
	await fs.ensureDir(hostConfig.get("host.mods_directory"));
	await fs.ensureDir("modules");

	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusteriohost";

	// make sure we have the controller access token
	if (hostConfig.get("host.controller_token") === "enter token here") {
		logger.fatal("ERROR invalid config!");
		logger.fatal(
			"Controller requires an access token for socket operations. As clusterio\n"+
			"hosts depends upon this, please set your token using the command npx\n"+
			"clusteriohost config set host.controller_token <token>.  You can generate an\n"+
			"auth token using npx clusterioctl generate-host-token."
		);
		process.exitCode = 1;
		return;
	}

	// make sure url ends with /
	if (!hostConfig.get("host.controller_url").endsWith("/")) {
		logger.fatal("ERROR invalid config!");
		logger.fatal("host.controller_url must end with '/'");
		process.exitCode = 1;
		return;
	}

	let tlsCa = null;
	let tlsCaPath = hostConfig.get("host.tls_ca");
	if (tlsCaPath) {
		tlsCa = await fs.readFile(tlsCaPath);
	}

	let hostConnector = new HostConnector(hostConfig, tlsCa, pluginInfos);
	let host = new Host(hostConnector, hostConfig, tlsCa, pluginInfos);

	// Handle interrupts
	let secondSigint = false;
	process.on("SIGINT", () => {
		if (secondSigint) {
			setBlocking(true);
			logger.fatal("Caught second interrupt, terminating immediately");
			// eslint-disable-next-line node/no-process-exit
			process.exit(1);
		}

		secondSigint = true;
		logger.info("Caught interrupt signal, shutting down");
		host.shutdown();
	});
	let secondSigterm = false;
	process.on("SIGTERM", () => {
		if (secondSigterm) {
			setBlocking(true);
			logger.fatal("Caught second termination, terminating immediately");
			// eslint-disable-next-line node/no-process-exit
			process.exit(1);
		}

		secondSigterm = true;
		logger.info("Caught termination signal, shutting down");
		host.shutdown();
	});
	process.on("SIGHUP", () => {
		logger.info("Terminal closed, shutting down");
		host.shutdown();
	});

	hostConnector.once("connect", () => {
		logger.add(new libLoggingUtils.LinkTransport({ link: host }));
	});

	await hostConnector.connect();
	logger.info("Started host");
}

if (module === require.main) {
	// eslint-disable-next-line no-console
	console.warn(`
+==========================================================+
I WARNING:  This is the development branch for the 2.0     I
I           version of clusterio.  Expect things to break. I
+==========================================================+
`
	);
	startHost().catch(err => {
		if (err instanceof libErrors.AuthenticationFailed) {
			logger.fatal(err.message);

		} else if (err instanceof libErrors.StartupError) {
			logger.fatal(`
+----------------------------------+
| Unable to to start clusteriohost |
+----------------------------------+
${err.stack}`
			);

		} else if (err instanceof libErrors.PluginError) {
			logger.fatal(`
${err.pluginName} plugin threw an unexpected error
during startup, please report it to the plugin author.
------------------------------------------------------
${err.original.stack}`
			);

		} else {
			logger.fatal(`
+------------------------------------------------------------+
| Unexpected error occured while starting host, please       |
| report it to https://github.com/clusterio/clusterio/issues |
+------------------------------------------------------------+
${err.stack}`
			);
		}

		process.exitCode = 1;
	});
}
