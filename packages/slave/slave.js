#!/usr/bin/env node

/**
 * Clusterio slave
 *
 * Connects to the controller and hosts Factorio servers that can
 * communicate with the cluster.  It is remotely controlled by {@link
 * module:controller/controller}.
 *
 * @module slave/slave
 * @author Danielv123, Hornwitser
 * @example
 * npx clusterioslave run
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
const libLink = require("@clusterio/lib/link");
const libPluginLoader = require("@clusterio/lib/plugin_loader");
const libErrors = require("@clusterio/lib/errors");
const libConfig = require("@clusterio/lib/config");
const libSharedCommands = require("@clusterio/lib/shared_commands");
const { ConsoleTransport, FilteredTransport, levels, logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");

const Slave = require("./src/Slave");


class SlaveConnector extends libLink.WebSocketClientConnector {
	constructor(slaveConfig, tlsCa, pluginInfos) {
		super(
			slaveConfig.get("slave.controller_url"),
			slaveConfig.get("slave.max_reconnect_delay"),
			tlsCa
		);
		this.slaveConfig = slaveConfig;
		this.pluginInfos = pluginInfos;
	}

	register() {
		logger.info("Connector | registering slave");
		let plugins = {};
		for (let pluginInfo of this.pluginInfos) {
			plugins[pluginInfo.name] = pluginInfo.version;
		}

		this.sendHandshake("register_slave", {
			token: this.slaveConfig.get("slave.controller_token"),
			agent: "Clusterio Slave",
			version,
			id: this.slaveConfig.get("slave.id"),
			name: this.slaveConfig.get("slave.name"),
			public_address: this.slaveConfig.get("slave.public_address"),
			plugins,
		});
	}
}


async function startSlave() {
	// argument parsing
	const args = yargs
		.scriptName("slave")
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
			describe: "slave config file to use",
			default: "config-slave.json",
			type: "string",
		})
		.option("plugin-list", {
			nargs: 1,
			describe: "File containing list of plugins available with their install path",
			default: "plugin-list.json",
			type: "string",
		})
		.command("plugin", "Manage available plugins", libSharedCommands.pluginCommand)
		.command("config", "Manage Slave config", libSharedCommands.configCommand)
		.command("run", "Run slave")
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	{
		// Migration from alpha-10 single file logs, note that we can't use
		// the logger here as it's not initalized yet.
		/* eslint-disable no-console */
		let slaveLogDirectory = path.join(args.logDirectory, "slave");
		if (!await fs.pathExists(slaveLogDirectory) && await fs.pathExists("slave.log")) {
			console.log("Migrating slave log...");
			await fs.ensureDir(slaveLogDirectory);
			await libLoggingUtils.migrateLogs("slave.log", slaveLogDirectory, "slave-%DATE%.log");
			console.log("Migration complete, you should delete slave.log now");
		}
		/* eslint-enable no-console */
	}

	logger.add(new winston.transports.DailyRotateFile({
		format: winston.format.json(),
		filename: "slave-%DATE%.log",
		utc: true,
		dirname: path.join(args.logDirectory, "slave"),
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
		logger.info(`Starting Clusterio slave ${version}`);
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
	libConfig.registerPluginConfigGroups(pluginInfos);
	libConfig.finalizeConfigs();

	logger.info(`Loading config from ${args.config}`);
	let slaveConfig = new libConfig.SlaveConfig("slave");
	try {
		await slaveConfig.load(JSON.parse(await fs.readFile(args.config)));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.info("Config not found, initializing new config");
			await slaveConfig.init();

		} else {
			throw new libErrors.StartupError(`Failed to load ${args.config}: ${err.message}`);
		}
	}

	if (command === "config") {
		await libSharedCommands.handleConfigCommand(args, slaveConfig, args.config);
		return;
	}

	// If we get here the command was run

	await fs.ensureDir(slaveConfig.get("slave.instances_directory"));
	await fs.ensureDir(slaveConfig.get("slave.mods_directory"));
	await fs.ensureDir("modules");

	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusterioSlave";

	// make sure we have the controller access token
	if (slaveConfig.get("slave.controller_token") === "enter token here") {
		logger.fatal("ERROR invalid config!");
		logger.fatal(
			"Controller requires an access token for socket operations. As clusterio\n"+
			"slaves depends upon this, please set your token using the command npx\n"+
			"clusterioslave config set slave.controller_token <token>.  You can generate an\n"+
			"auth token using npx clusterioctl generate-slave-token."
		);
		process.exitCode = 1;
		return;
	}

	// make sure url ends with /
	if (!slaveConfig.get("slave.controller_url").endsWith("/")) {
		logger.fatal("ERROR invalid config!");
		logger.fatal("slave.controller_url must end with '/'");
		process.exitCode = 1;
		return;
	}

	let tlsCa = null;
	let tlsCaPath = slaveConfig.get("slave.tls_ca");
	if (tlsCaPath) {
		tlsCa = await fs.readFile(tlsCaPath);
	}

	let slaveConnector = new SlaveConnector(slaveConfig, tlsCa, pluginInfos);
	let slave = new Slave(slaveConnector, slaveConfig, tlsCa, pluginInfos);

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
		slave.shutdown();
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
		slave.shutdown();
	});
	process.on("SIGHUP", () => {
		logger.info("Terminal closed, shutting down");
		slave.shutdown();
	});

	slaveConnector.once("connect", () => {
		logger.add(new libLoggingUtils.LinkTransport({ link: slave }));
	});

	await slaveConnector.connect();
	logger.info("Started slave");
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
	startSlave().catch(err => {
		if (err instanceof libErrors.AuthenticationFailed) {
			logger.fatal(err.message);

		} else if (err instanceof libErrors.StartupError) {
			logger.fatal(`
+-----------------------------------+
| Unable to to start clusterioslave |
+-----------------------------------+
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
| Unexpected error occured while starting slave, please      |
| report it to https://github.com/clusterio/clusterio/issues |
+------------------------------------------------------------+
${err.stack}`
			);
		}

		process.exitCode = 1;
	});
}
