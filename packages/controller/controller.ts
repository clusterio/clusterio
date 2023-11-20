#!/usr/bin/env node

/**
 * Clusterio controller
 *
 * Facilitates communication between hosts and control of the cluster
 * through WebSocet connections, and hosts a webserver for browser
 * interfaces and Prometheus statistics export.  It is remotely controlled
 * by {@link module:ctl/ctl}.
 *
 * @module controller/controller
 * @author Danielv123, Hornwitser
 * @example
 * npx clusteriocontroller run
 */

import path from "path";
import fs from "fs-extra";

import crypto from "crypto";
import setBlocking from "set-blocking";
import yargs from "yargs";
import util from "util";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

import jwt from "jsonwebtoken";

// homebrew modules
import * as lib from "@clusterio/lib";
const { ConsoleTransport, levels, logger } = lib;

import Controller from "./src/Controller";
import UserManager from "./src/UserManager";
import { version } from "./package.json";

// globals
let controller: Controller;


void new lib.Gauge(
	"clusterio_controller_host_mapping",
	"Mapping of Host ID to name",
	{
		labels: ["host_id", "host_name"],
		callback: function(gauge:lib.Gauge) {
			gauge.clear();
			if (!controller || !controller.hosts) {
				return;
			}
			for (let [id, host] of controller.hosts) {
				gauge.labels({
					host_id: String(id),
					host_name: host.name,
				}).set(1);
			};
		},
	}
);

void new lib.Gauge(
	"clusterio_controller_instance_mapping",
	"Mapping of Instance ID to name and host",
	{
		labels: ["instance_id", "instance_name", "host_id"],
		callback: function(gauge:lib.Gauge) {
			gauge.clear();
			if (!controller || !controller.instances) {
				return;
			}
			for (let [id, instance] of controller.instances) {
				gauge.labels({
					instance_id: String(id),
					instance_name: String(instance.config.get("instance.name")),
					host_id: String(instance.config.get("instance.assigned_host")),
				}).set(1);
			}
		},
	}
);

void new lib.Gauge(
	"clusterio_controller_websocket_active_connections",
	"How many WebSocket connections are currently open to the controller",
	{ callback: function(gauge:lib.Gauge) {
		gauge.set(controller.wsServer.activeConnectors.size);
	}}
);

void new lib.Gauge(
	"clusterio_controller_active_hosts",
	"How many hosts are currently connected to the controller",
	{ callback: function(gauge:lib.Gauge) {
		gauge.set(controller.wsServer.hostConnections.size);
	}}
);

void new lib.Gauge(
	"clusterio_controller_connected_clients_count",
	"How many clients are currently connected to this controller",
	{
		labels: ["type"], callback: async function(gauge:lib.Gauge) {
			gauge.labels("host").set(controller.wsServer.hostConnections.size);
			gauge.labels("control").set(controller.wsServer.controlConnections.size);
		},
	},
);


async function handleBootstrapCommand(
	args: any,
	controllerConfig: lib.ControllerConfig
): Promise<void> {
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

		let adminRole = lib.ensureDefaultAdminRole(userManager.roles);
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
		console.log(userManager.signUserToken(user.name));

	} else if (subCommand === "generate-host-token") {
		// eslint-disable-next-line no-console
		console.log(jwt.sign(
			{ aud: "host", host: args.id },
			Buffer.from(controllerConfig.get("controller.auth_secret"), "base64")
		));

	} else if (subCommand === "create-ctl-config") {
		let admin = userManager.users.get(args.name);
		if (!admin) {
			logger.error(`No user named '${args.name}'`);
			process.exitCode = 1;
			return;
		}
		let controlConfig = new lib.ControlConfig("control");
		await controlConfig.init();

		controlConfig.set("control.controller_url", Controller.calculateControllerUrl(controllerConfig));
		controlConfig.set(
			"control.controller_token",
			userManager.signUserToken(admin.name),
		);

		let content = JSON.stringify(controlConfig.serialize(), null, 4);
		if (args.output === "-") {
			// eslint-disable-next-line no-console
			console.log(content);
		} else {
			logger.info(`Writing ${args.output}`);
			await lib.safeOutputFile(args.output, content);
		}
	}
}


export interface ControllerArgs {
	[x: string]: unknown;
	logLevel: string;
	logDirectory: string;
	pluginList: string;
	devPlugin?: (string | number)[] | undefined;
	dev?: boolean;
	config: string;
	_: (string | number)[];
	$0: string;
}

interface InitializeParameters {
	args: ControllerArgs;
	shouldRun: boolean;
	clusterLogger: winston.Logger;
	pluginInfos: lib.PluginNodeEnvInfo[] | null;
	controllerConfigPath: string | null;
	controllerConfig: lib.ControllerConfig | null;
}

async function initialize(): Promise<InitializeParameters> {
	// argument parsing
	const args = await yargs
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
		.command("plugin", "Manage available plugins", lib.pluginCommand)
		.command("config", "Manage Controller config", lib.configCommand)
		.command("bootstrap", "Bootstrap access to cluster", yargs => {
			yargs
				.command("create-admin <name>", "Create a cluster admin")
				.command("generate-user-token <name>", "Generate authentication token for the given user")
				.command("generate-host-token <id>", "Generate authentication token for the given host", yargs => {
					yargs.positional("id", { describe: "ID of the host", type: "number" });
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

	// Combined log stream of the whole cluster.
	const clusterLogger = winston.createLogger({
		format: winston.format.json(),
		level: "verbose",
		levels,
	});
	clusterLogger.add(new DailyRotateFile({
		filename: "cluster-%DATE%.log",
		utc: true,
		dirname: path.join(args.logDirectory, "cluster"),
	}));

	// Log stream for the controller.
	logger.add(new DailyRotateFile({
		format: winston.format.json(),
		filename: "controller-%DATE%.log",
		dirname: path.join(args.logDirectory, "controller"),
	}));
	logger.add(new winston.transports.Stream({
		stream: clusterLogger,
	}));
	if (args.logLevel !== "none") {
		logger.add(new ConsoleTransport({
			level: args.logLevel,
			format: new lib.TerminalFormat(),
		}));
	}
	lib.handleUnhandledErrors();

	let command = args._[0];
	let shouldRun = false;
	if (command === "run") {
		logger.info(`Starting Clusterio controller ${version}`);
		shouldRun = true;
	}

	logger.info(`Loading available plugins from ${args.pluginList}`);
	let pluginList = new Map();
	try {
		pluginList = new Map(JSON.parse(await fs.readFile(args.pluginList, { encoding: "utf8" })));
	} catch (err: any) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	// If the command is plugin management we don't try to load plugins
	if (command === "plugin") {
		await lib.handlePluginCommand(args, pluginList, args.pluginList);
		return {
			args,
			shouldRun,
			clusterLogger,
			pluginInfos: null,
			controllerConfigPath: null,
			controllerConfig: null,
		};
	}

	logger.info("Loading Plugin info");
	const pluginInfos = await lib.loadPluginInfos(pluginList);
	lib.registerPluginMessages(pluginInfos);
	lib.registerPluginConfigGroups(pluginInfos);
	lib.finalizeConfigs();

	const controllerConfigPath = args.config;
	logger.info(`Loading config from ${controllerConfigPath}`);
	const controllerConfig = new lib.ControllerConfig("controller");
	try {
		let fileData = await fs.readFile(controllerConfigPath, { encoding: "utf8" });
		await controllerConfig.load(JSON.parse(fileData));

	} catch (err: any) {
		if (err.code === "ENOENT") {
			logger.info("Config not found, initializing new config");
			await controllerConfig.init();

		} else {
			throw new lib.StartupError(`Failed to load ${controllerConfigPath}: ${err.message}`);
		}
	}

	if (!controllerConfig.get("controller.auth_secret")) {
		logger.info("Generating new controller authentication secret");
		let asyncRandomBytes = util.promisify(crypto.randomBytes);
		let bytes = await asyncRandomBytes(256);
		controllerConfig.set("controller.auth_secret", bytes.toString("base64"));
		await lib.safeOutputFile(
			controllerConfigPath, JSON.stringify(controllerConfig.serialize(), null, 4)
		);
	}

	if (command === "config") {
		await lib.handleConfigCommand(
			args, controllerConfig, controllerConfigPath
		);

	} else if (command === "bootstrap") {
		await handleBootstrapCommand(args, controllerConfig);
	}

	return {
		args,
		clusterLogger,
		pluginInfos,
		controllerConfigPath,
		controllerConfig,
		shouldRun,
	};
}

async function startup() {
	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusteriocontroller";

	let {
		args,
		shouldRun,
		clusterLogger,
		pluginInfos,
		controllerConfigPath,
		controllerConfig,
	} = await initialize();
	if (!shouldRun || !pluginInfos || !controllerConfigPath || !controllerConfig) {
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
		if (err instanceof lib.StartupError) {
			logger.fatal(`
+-------------------------------+
| Unable to to start controller |
+-------------------------------+
${err.stack}`
			);
		} else if (err instanceof lib.PluginError) {
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
