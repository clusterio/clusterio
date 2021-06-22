#!/usr/bin/env node

/**
 * Clusterio master server
 *
 * Facilitates communication between slaves and control of the cluster
 * through WebSocet connections, and hosts a webserver for browser
 * interfaces and Prometheus statistics export.  It is remotely controlled
 * by {@link module:ctl/ctl}.
 *
 * @module master/master
 * @author Danielv123, Hornwitser
 * @example
 * npx clusteriomaster run
 */

"use strict";
const path = require("path");
const fs = require("fs-extra");
const crypto = require("crypto");
const setBlocking = require("set-blocking");
const yargs = require("yargs");
const util = require("util");
const winston = require("winston");
const jwt = require("jsonwebtoken");

// homebrew modules
const libErrors = require("@clusterio/lib/errors");
const libPluginLoader = require("@clusterio/lib/plugin_loader");
const libPrometheus = require("@clusterio/lib/prometheus");
const libConfig = require("@clusterio/lib/config");
const libUsers = require("@clusterio/lib/users");
const libSharedCommands = require("@clusterio/lib/shared_commands");
const { ConsoleTransport, levels, logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");

const Master = require("./src/Master");
const UserManager = require("./src/UserManager");

// globals
let master;


const slaveMappingGauge = new libPrometheus.Gauge(
	"clusterio_master_slave_mapping",
	"Mapping of Slave ID to name",
	{
		labels: ["slave_id", "slave_name"],
		callback: function() {
			slaveMappingGauge.clear();
			if (!master || !master.slaves) {
				return;
			}
			for (let [id, slave] of master.slaves) {
				slaveMappingGauge.labels({
					slave_id: String(id),
					slave_name: slave.name,
				}).set(1);
			};
		},
	}
);

const instanceMappingGauge = new libPrometheus.Gauge(
	"clusterio_master_instance_mapping",
	"Mapping of Instance ID to name and slave",
	{
		labels: ["instance_id", "instance_name", "slave_id"],
		callback: function() {
			instanceMappingGauge.clear();
			if (!master || !master.instances) {
				return;
			}
			for (let [id, instance] of master.instances) {
				instanceMappingGauge.labels({
					instance_id: String(id),
					instance_name: String(instance.config.get("instance.name")),
					slave_id: String(instance.config.get("instance.assigned_slave")),
				}).set(1);
			}
		},
	}
);

const wsActiveConnectionsGauge = new libPrometheus.Gauge(
	"clusterio_master_websocket_active_connections",
	"How many WebSocket connections are currently open to the master server",
	{ callback: function(gauge) { gauge.set(master.wsServer.activeConnectors.size); }}
);

const wsActiveSlavesGauge = new libPrometheus.Gauge(
	"clusterio_master_active_slaves",
	"How many slaves are currently connected to the master",
	{ callback: function(gauge) { gauge.set(master.wsServer.slaveConnections.size); }}
);

const masterConnectedClientsCount = new libPrometheus.Gauge(
	"clusterio_master_connected_clients_count", "How many clients are currently connected to this master server",
	{
		labels: ["type"], callback: async function(gauge) {
			gauge.labels("slave").set(master.wsServer.slaveConnections.size);
			gauge.labels("control").set(master.wsServer.controlConnections.length);
		},
	},
);


async function handleBootstrapCommand(args, masterConfig) {
	let subCommand = args._[1];
	let userManager = new UserManager(masterConfig);
	await userManager.load(path.join(masterConfig.get("master.database_directory"), "users.json"));
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
		await userManager.save(path.join(masterConfig.get("master.database_directory"), "users.json"));

	} else if (subCommand === "generate-user-token") {
		let user = userManager.users.get(args.name);
		if (!user) {
			logger.error(`No user named '${args.name}'`);
			process.exitCode = 1;
			return;
		}
		// eslint-disable-next-line no-console
		console.log(user.createToken(masterConfig.get("master.auth_secret")));

	} else if (subCommand === "generate-slave-token") {
		// eslint-disable-next-line no-console
		console.log(jwt.sign({ aud: "slave", slave: args.id }, masterConfig.get("master.auth_secret")));

	} else if (subCommand === "create-ctl-config") {
		let admin = userManager.users.get(args.name);
		if (!admin) {
			logger.error(`No user named '${args.name}'`);
			process.exitCode = 1;
			return;
		}
		let controlConfig = new libConfig.ControlConfig("control");
		await controlConfig.init();

		controlConfig.set("control.master_url", Master.calculateMasterUrl(masterConfig));
		controlConfig.set("control.master_token", admin.createToken(masterConfig.get("master.auth_secret")));

		let content = JSON.stringify(controlConfig.serialize(), null, 4);
		if (args.output === "-") {
			// eslint-disable-next-line no-console
			console.log(content);
		} else {
			logger.info(`Writing ${args.output}`);
			await fs.outputFile(args.output, content);
		}
	}
}

async function initialize() {
	let parameters = {
		args: null,
		shouldRun: false,
		clusterLogger: null,
		pluginInfos: null,
		masterConfigPath: null,
		masterConfig: null,
	};

	// argument parsing
	parameters.args = yargs
		.scriptName("master")
		.usage("$0 <command> [options]")
		.option("log-level", {
			nargs: 1,
			describe: "Log level to print to stdout",
			default: "info",
			choices: ["none"].concat(Object.keys(levels)),
			type: "string",
		})
		.option("config", {
			nargs: 1,
			describe: "master config file to use",
			default: "config-master.json",
			type: "string",
		})
		.option("plugin-list", {
			nargs: 1,
			describe: "File containing list of plugins available with their install path",
			default: "plugin-list.json",
			type: "string",
		})
		.command("plugin", "Manage available plugins", libSharedCommands.pluginCommand)
		.command("config", "Manage Master config", libSharedCommands.configCommand)
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
		.command("run", "Run master server", yargs => {
			yargs.option("dev", { hidden: true, type: "boolean", nargs: 0 });
			yargs.option("dev-plugin", { hidden: true, type: "array" });
		})
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	// Combined log stream of the whole cluster.
	parameters.clusterLogger = winston.createLogger({
		format: winston.format.json(),
		level: "verbose",
		levels,
	});
	parameters.clusterLogger.add(new winston.transports.File({
		filename: "cluster.log",
	}));

	// Log stream for the master server.
	logger.add(new winston.transports.File({
		format: winston.format.json(),
		filename: "master.log",
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
	let command = parameters.args._[0];
	if (command === "plugin") {
		await libSharedCommands.handlePluginCommand(parameters.args, pluginList, parameters.args.pluginList);
		return parameters;
	}

	logger.info("Loading Plugin info");
	parameters.pluginInfos = await libPluginLoader.loadPluginInfos(pluginList);
	libConfig.registerPluginConfigGroups(parameters.pluginInfos);
	libConfig.finalizeConfigs();

	parameters.masterConfigPath = parameters.args.config;
	logger.info(`Loading config from ${parameters.masterConfigPath}`);
	parameters.masterConfig = new libConfig.MasterConfig("master");
	try {
		await parameters.masterConfig.load(JSON.parse(await fs.readFile(parameters.masterConfigPath)));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.info("Config not found, initializing new config");
			await parameters.masterConfig.init();

		} else {
			throw new libErrors.StartupError(`Failed to load ${parameters.masterConfigPath}: ${err.message}`);
		}
	}

	if (!parameters.masterConfig.get("master.auth_secret")) {
		logger.info("Generating new master authentication secret");
		let asyncRandomBytes = util.promisify(crypto.randomBytes);
		let bytes = await asyncRandomBytes(256);
		parameters.masterConfig.set("master.auth_secret", bytes.toString("base64"));
		await fs.outputFile(parameters.masterConfigPath, JSON.stringify(parameters.masterConfig.serialize(), null, 4));
	}

	if (command === "config") {
		await libSharedCommands.handleConfigCommand(
			parameters.args, parameters.masterConfig, parameters.masterConfigPath
		);
		return parameters;

	} else if (command === "bootstrap") {
		await handleBootstrapCommand(parameters.args, parameters.masterConfig);
		return parameters;
	}

	// If we get here the command was run
	parameters.shouldRun = true;
	return parameters;
}

async function startup() {
	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusterioMaster";

	// add better stack traces on promise rejection
	process.on("unhandledRejection", err => logger.error(`Unhandled rejection:\n${err.stack}`));

	let { args, shouldRun, clusterLogger, pluginInfos, masterConfigPath, masterConfig } = await initialize(master);
	if (!shouldRun) {
		return;
	}

	master = new Master(clusterLogger, pluginInfos, masterConfigPath, masterConfig);

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
		master.stop();
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
		master.stop();
	});

	process.on("SIGHUP", () => {
		logger.info("Terminal closed, shutting down");
		master.stop();
	});

	await master.start(args);
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
+----------------------------------+
| Unable to to start master server |
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
| Unexpected error occured while starting master, please     |
| report it to https://github.com/clusterio/clusterio/issues |
+------------------------------------------------------------+
${err.stack}`
			);
		}

		process.exitCode = 1;
	});
}
