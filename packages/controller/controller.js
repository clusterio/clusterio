#!/usr/bin/env node

/**
 * Clusterio controller
 *
 * Facilitates communication between slaves and control of the cluster
 * through WebSocet connections, and hosts a webserver for browser
 * interfaces and Prometheus statistics export.  It is remotely controlled
 * by {@link module:ctl/ctl}.
 *
 * @module controller/controller
 * @author Danielv123, Hornwitser
 * @example
 * npx clusteriocontroller run
 */

"use strict";
const path = require("path");
const fs = require("fs-extra");
const crypto = require("crypto");
const setBlocking = require("set-blocking");
const yargs = require("yargs");
const util = require("util");
const winston = require("winston");
require("winston-daily-rotate-file");
const jwt = require("jsonwebtoken");

// homebrew modules
const libErrors = require("@clusterio/lib/errors");
const libFileOps = require("@clusterio/lib/file_ops");
const libPluginLoader = require("@clusterio/lib/plugin_loader");
const libPrometheus = require("@clusterio/lib/prometheus");
const libConfig = require("@clusterio/lib/config");
const libUsers = require("@clusterio/lib/users");
const libSharedCommands = require("@clusterio/lib/shared_commands");
const { ConsoleTransport, levels, logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");

const Controller = require("./src/Controller");
const UserManager = require("./src/UserManager");
const version = require("./package").version;

// globals
let controller;


void new libPrometheus.Gauge(
	"clusterio_controller_slave_mapping",
	"Mapping of Slave ID to name",
	{
		labels: ["slave_id", "slave_name"],
		callback: function(gauge) {
			gauge.clear();
			if (!controller || !controller.slaves) {
				return;
			}
			for (let [id, slave] of controller.slaves) {
				gauge.labels({
					slave_id: String(id),
					slave_name: slave.name,
				}).set(1);
			};
		},
	}
);

void new libPrometheus.Gauge(
	"clusterio_controller_instance_mapping",
	"Mapping of Instance ID to name and slave",
	{
		labels: ["instance_id", "instance_name", "slave_id"],
		callback: function(gauge) {
			gauge.clear();
			if (!controller || !controller.instances) {
				return;
			}
			for (let [id, instance] of controller.instances) {
				gauge.labels({
					instance_id: String(id),
					instance_name: String(instance.config.get("instance.name")),
					slave_id: String(instance.config.get("instance.assigned_slave")),
				}).set(1);
			}
		},
	}
);

void new libPrometheus.Gauge(
	"clusterio_controller_websocket_active_connections",
	"How many WebSocket connections are currently open to the controller",
	{ callback: function(gauge) { gauge.set(controller.wsServer.activeConnectors.size); }}
);

void new libPrometheus.Gauge(
	"clusterio_controller_active_slaves",
	"How many slaves are currently connected to the controller",
	{ callback: function(gauge) { gauge.set(controller.wsServer.slaveConnections.size); }}
);

void new libPrometheus.Gauge(
	"clusterio_controller_connected_clients_count", "How many clients are currently connected to this controller",
	{
		labels: ["type"], callback: async function(gauge) {
			gauge.labels("slave").set(controller.wsServer.slaveConnections.size);
			gauge.labels("control").set(controller.wsServer.controlConnections.length);
		},
	},
);


async function handleBootstrapCommand(args, controllerConfig) {
	let subCommand = args._[1];
	let userManager = new UserManager(controllerConfig);
	await userManager.load(path.join(controllerConfig.get("controller.database_directory"), "users.json"));
	if (subCommand === "create-admin") {
		if (!args.name) {
			logger.error("name cannot be blank");
			process.exitCode = 1;
			return;
		}

		let admin = userManager.users.get(args.name);
		if (!admin) {
			admin = userManager.createUser(args.name);
		}

		let adminRole = libUsers.ensureDefaultAdminRole(userManager.roles);
		admin.roles.add(adminRole);
		admin.isAdmin = true;
		await userManager.save(path.join(controllerConfig.get("controller.database_directory"), "users.json"));

	} else if (subCommand === "generate-user-token") {
		let user = userManager.users.get(args.name);
		if (!user) {
			logger.error(`No user named '${args.name}'`);
			process.exitCode = 1;
			return;
		}
		// eslint-disable-next-line no-console
		console.log(user.createToken(controllerConfig.get("controller.auth_secret")));

	} else if (subCommand === "generate-slave-token") {
		// eslint-disable-next-line no-console
		console.log(jwt.sign(
			{ aud: "slave", slave: args.id },
			Buffer.from(controllerConfig.get("controller.auth_secret"), "base64")
		));

	} else if (subCommand === "create-ctl-config") {
		let admin = userManager.users.get(args.name);
		if (!admin) {
			logger.error(`No user named '${args.name}'`);
			process.exitCode = 1;
			return;
		}
		let controlConfig = new libConfig.ControlConfig("control");
		await controlConfig.init();

		controlConfig.set("control.controller_url", Controller.calculateControllerUrl(controllerConfig));
		controlConfig.set(
			"control.controller_token", admin.createToken(controllerConfig.get("controller.auth_secret"))
		);

		let content = JSON.stringify(controlConfig.serialize(), null, 4);
		if (args.output === "-") {
			// eslint-disable-next-line no-console
			console.log(content);
		} else {
			logger.info(`Writing ${args.output}`);
			await libFileOps.safeOutputFile(args.output, content);
		}
	}
}

async function initialize() {
	let parameters = {
		args: null,
		shouldRun: false,
		clusterLogger: null,
		pluginInfos: null,
		controllerConfigPath: null,
		controllerConfig: null,
	};

	// argument parsing
	parameters.args = yargs
		.scriptName("controller")
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
			describe: "controller config file to use",
			default: "config-controller.json",
			type: "string",
		})
		.option("plugin-list", {
			nargs: 1,
			describe: "File containing list of plugins available with their install path",
			default: "plugin-list.json",
			type: "string",
		})
		.command("plugin", "Manage available plugins", libSharedCommands.pluginCommand)
		.command("config", "Manage Controller config", libSharedCommands.configCommand)
		.command("bootstrap", "Bootstrap access to cluster", yargs => {
			yargs
				.command("create-admin <name>", "Create a cluster admin")
				.command("generate-user-token <name>", "Generate authentication token for the given user")
				.command("generate-slave-token <id>", "Generate authentication token for the given slave", yargs => {
					yargs.positional("id", { describe: "ID of the slave", type: "number" });
				})
				.command("create-ctl-config <name>", "Create clusterioctl config for the given user", yargs => {
					yargs.option("output", {
						describe: "Path to output config (- for stdout)", type: "string",
						nargs: 1, default: "config-control.json",
					});
				})
				.demandCommand(1, "You need to specify a command to run");
		})
		.command("run", "Run controller", yargs => {
			yargs.option("dev", { hidden: true, type: "boolean", nargs: 0 });
			yargs.option("dev-plugin", { hidden: true, type: "array" });
		})
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	{
		// Migration from alpha-10 single file logs, note that we can't use
		// the logger here as it's not initalized yet.
		/* eslint-disable no-console */
		let clusterLogDirectory = path.join(parameters.args.logDirectory, "cluster");
		if (!await fs.pathExists(clusterLogDirectory) && await fs.pathExists("cluster.log")) {
			console.log("Migrating cluster log...");
			await fs.ensureDir(clusterLogDirectory);
			await libLoggingUtils.migrateLogs("cluster.log", clusterLogDirectory, "cluster-%DATE%.log");
			console.log("Migration complete, you should delete cluster.log now");
		}

		let controllerLogDirectory = path.join(parameters.args.logDirectory, "controller");
		if (!await fs.pathExists(controllerLogDirectory) && await fs.pathExists("controller.log")) {
			console.log("Migrating controller log...");
			await fs.ensureDir(controllerLogDirectory);
			await libLoggingUtils.migrateLogs("controller.log", controllerLogDirectory, "controller-%DATE%.log");
			console.log("Migration complete, you should delete controller.log now");
		}
		/* eslint-enable no-console */
	}

	// Combined log stream of the whole cluster.
	parameters.clusterLogger = winston.createLogger({
		format: winston.format.json(),
		level: "verbose",
		levels,
	});
	parameters.clusterLogger.add(new winston.transports.DailyRotateFile({
		filename: "cluster-%DATE%.log",
		utc: true,
		dirname: path.join(parameters.args.logDirectory, "cluster"),
	}));

	// Log stream for the controller.
	logger.add(new winston.transports.DailyRotateFile({
		format: winston.format.json(),
		filename: "controller-%DATE%.log",
		dirname: path.join(parameters.args.logDirectory, "controller"),
	}));
	logger.add(new winston.transports.Stream({
		stream: parameters.clusterLogger,
	}));
	if (parameters.args.logLevel !== "none") {
		logger.add(new ConsoleTransport({
			level: parameters.args.logLevel,
			format: new libLoggingUtils.TerminalFormat(),
		}));
	}
	libLoggingUtils.handleUnhandledErrors(logger);

	let command = parameters.args._[0];
	if (command === "run") {
		logger.info(`Starting Clusterio controller ${version}`);
		parameters.shouldRun = true;
	}

	logger.info(`Loading available plugins from ${parameters.args.pluginList}`);
	let pluginList = new Map();
	try {
		pluginList = new Map(JSON.parse(await fs.readFile(parameters.args.pluginList)));
	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	// If the command is plugin management we don't try to load plugins
	if (command === "plugin") {
		await libSharedCommands.handlePluginCommand(parameters.args, pluginList, parameters.args.pluginList);
		return parameters;
	}

	logger.info("Loading Plugin info");
	parameters.pluginInfos = await libPluginLoader.loadPluginInfos(pluginList);
	libConfig.registerPluginConfigGroups(parameters.pluginInfos);
	libConfig.finalizeConfigs();

	parameters.controllerConfigPath = parameters.args.config;
	logger.info(`Loading config from ${parameters.controllerConfigPath}`);
	parameters.controllerConfig = new libConfig.ControllerConfig("controller");
	try {
		await parameters.controllerConfig.load(JSON.parse(await fs.readFile(parameters.controllerConfigPath)));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.info("Config not found, initializing new config");
			await parameters.controllerConfig.init();

		} else {
			throw new libErrors.StartupError(`Failed to load ${parameters.controllerConfigPath}: ${err.message}`);
		}
	}

	if (!parameters.controllerConfig.get("controller.auth_secret")) {
		logger.info("Generating new controller authentication secret");
		let asyncRandomBytes = util.promisify(crypto.randomBytes);
		let bytes = await asyncRandomBytes(256);
		parameters.controllerConfig.set("controller.auth_secret", bytes.toString("base64"));
		await libFileOps.safeOutputFile(
			parameters.controllerConfigPath, JSON.stringify(parameters.controllerConfig.serialize(), null, 4)
		);
	}

	if (command === "config") {
		await libSharedCommands.handleConfigCommand(
			parameters.args, parameters.controllerConfig, parameters.controllerConfigPath
		);

	} else if (command === "bootstrap") {
		await handleBootstrapCommand(parameters.args, parameters.controllerConfig);
	}

	return parameters;
}

async function startup() {
	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusterioController";

	let { args, shouldRun, clusterLogger, pluginInfos, controllerConfigPath, controllerConfig } = await initialize();
	if (!shouldRun) {
		return;
	}

	controller = new Controller(clusterLogger, pluginInfos, controllerConfigPath, controllerConfig);

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
		controller.stop();
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
		controller.stop();
	});

	process.on("SIGHUP", () => {
		logger.info("Terminal closed, shutting down");
		controller.stop();
	});

	await controller.start(args);
}

module.exports = {
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
	startup().catch(err => {
		if (err instanceof libErrors.StartupError) {
			logger.fatal(`
+-------------------------------+
| Unable to to start controller |
+-------------------------------+
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
| Unexpected error occured while starting controller, please |
| report it to https://github.com/clusterio/clusterio/issues |
+------------------------------------------------------------+
${err.stack}`
			);
		}

		process.exitCode = 1;
	});
}
