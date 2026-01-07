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
	"clusterio_controller_pending_requests",
	"Count of pending link requests currently waiting in memory on the controller.",
	{
		callback: (gauge) => {
			let count = 0;
			if (controller) {
				for (const host of controller.wsServer.hostConnections.values()) {
					count += host.pendingRequestCount;
				}
				for (const control of controller.wsServer.controlConnections.values()) {
					count += control.pendingRequestCount;
				}
			}
			gauge.set(count);
		},
	}
);

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
			for (const host of controller.hosts.values()) {
				gauge.labels({
					host_id: String(host.id),
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
			for (const instance of controller.instances.values()) {
				gauge.labels({
					instance_id: String(instance.id),
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
	controllerConfig: lib.ControllerConfig,
	controllerConfigLock: lib.LockFile,
): Promise<void> {
	let subCommand = args._[1];

	const databaseDirectory = controllerConfig.get("controller.database_directory");
	const roles = new lib.SubscribableDatastore(...await new lib.JsonIdDatastoreProvider(
		path.join(databaseDirectory, "roles.json"),
		lib.Role.fromJSON.bind(lib.Role),
	).bootstrap());

	const userManager = new UserManager(controllerConfig, roles);
	await userManager.load(path.join(databaseDirectory, "users.json"));

	if (subCommand === "create-admin") {
		await controllerConfigLock.acquire(); // Also needed to write to the database files

		if (!args.name) {
			logger.error("name cannot be blank");
			process.exitCode = 1;
			return;
		}

		let admin = userManager.getByName(args.name);
		if (!admin) {
			admin = userManager.createUser(args.name);
		}

		let adminRole = lib.ensureDefaultAdminRole(roles);
		admin.roleIds.add(adminRole.id);
		admin.isAdmin = true;
		await userManager.save(path.join(controllerConfig.get("controller.database_directory"), "users.json"));
		await controllerConfigLock.release();

	} else if (subCommand === "generate-user-token") {
		let user = userManager.getByName(args.name);
		if (!user) {
			logger.error(`No user named '${args.name}'`);
			process.exitCode = 1;
			return;
		}
		// eslint-disable-next-line no-console
		console.log(userManager.signUserToken(user));

	} else if (subCommand === "generate-host-token") {
		// eslint-disable-next-line no-console
		console.log(jwt.sign(
			{ aud: "host", host: args.id },
			Buffer.from(controllerConfig.get("controller.auth_secret"), "base64")
		));

	} else if (subCommand === "create-ctl-config") {
		let admin = userManager.getByName(args.name);
		if (!admin) {
			logger.error(`No user named '${args.name}'`);
			process.exitCode = 1;
			return;
		}
		let controlConfig = new lib.ControlConfig("control");

		controlConfig.set("control.controller_url", Controller.calculateControllerUrl(controllerConfig));
		controlConfig.set(
			"control.controller_token",
			userManager.signUserToken(admin),
		);

		let content = JSON.stringify(controlConfig, null, "\t");
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
				.command("create-admin <name>", "Create a cluster admin", yargs => {
					yargs.positional("name", { describe: "Name of the admin user", type: "string" });
				})
				.command("generate-user-token <name>", "Generate authentication token for the given user", yargs => {
					yargs.positional("name", { describe: "Name of the user", type: "string" });
				})
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
			yargs.option("can-restart", {
				type: "boolean", nargs: 0, default: false,
				describe: "Indicate that a process monitor will restart the controller on failure",
			});
			yargs.option("recovery", {
				type: "boolean", nargs: 0, default: false,
				describe: "Start the controller in recovery mode with all plugins disabled and hosts disconnected",
			});
			yargs.option("check-user-count", { hidden: true, type: "boolean", nargs: 0, default: true });
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
		format: winston.format.json(),
		filename: "cluster-%DATE%.log",
		utc: true,
		dirname: path.join(args.logDirectory, "cluster"),
	}));

	// Log stream for the controller.
	logger.add(new DailyRotateFile({
		format: winston.format.json(),
		filename: "controller-%DATE%.log",
		utc: true,
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
		if (args.recovery) {
			logger.warn("Controller recovery mode enabled. Some features will be disabled.");
		}
		shouldRun = true;
	}

	logger.info(`Loading available plugins from ${args.pluginList}`);
	let pluginList = await lib.loadPluginList(args.pluginList);

	// If the command is plugin management we don't try to load plugins
	if (command === "plugin") {
		await lib.handlePluginCommand(args, pluginList, args.pluginList);
		return {
			args,
			shouldRun,
			clusterLogger,
			pluginInfos: null,
			controllerConfig: null,
		};
	}

	logger.info("Loading Plugin info");
	const pluginInfos = await lib.loadPluginInfos(pluginList);
	lib.registerPluginMessages(pluginInfos);
	lib.addPluginConfigFields(pluginInfos);

	let controllerConfig;
	const controllerConfigPath = args.config;
	const controllerConfigLock = new lib.LockFile(`${controllerConfigPath}.lock`);
	logger.info(`Loading config from ${controllerConfigPath}`);
	try {
		controllerConfig = await lib.ControllerConfig.fromFile("controller", controllerConfigPath);

	} catch (err: any) {
		if (err.code === "ENOENT") {
			logger.info("Config not found, initializing new config");
			controllerConfig = new lib.ControllerConfig("controller", undefined, controllerConfigPath);

		} else {
			throw new lib.StartupError(`Failed to load ${controllerConfigPath}: ${err.stack ?? err.message ?? err}`);
		}
	}

	controllerConfig.set("controller.version", version); // Allows tracking last loaded version

	if (!controllerConfig.get("controller.auth_secret")) {
		logger.info("Generating new controller authentication secret");
		let asyncRandomBytes = util.promisify(crypto.randomBytes);
		let bytes = await asyncRandomBytes(256);
		controllerConfig.set("controller.auth_secret", bytes.toString("base64"));
		await controllerConfig.save();
	}

	if (command === "config") {
		await lib.handleConfigCommand(args, controllerConfig, controllerConfigLock);
	} else if (command === "bootstrap") {
		await handleBootstrapCommand(args, controllerConfig, controllerConfigLock);
	} else if (shouldRun) {
		await controllerConfigLock.acquire(); // Hold the lock until process exit
	}

	return {
		args,
		clusterLogger,
		pluginInfos,
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
		controllerConfig,
	} = await initialize();
	if (!shouldRun || !pluginInfos || !controllerConfig) {
		return;
	}

	controller = new Controller(
		clusterLogger,
		pluginInfos,
		controllerConfig,
		Boolean(args.canRestart),
		Boolean(args.recovery),
		...await Controller.bootstrap(controllerConfig)
	);

	// Refuse to start if there are no users loaded
	if (args.checkUserCount && controller.userManager.users.size === 0) {
		logger.fatal(
			"Cannot start controller, no users loaded.\n" +
			"Try `npx clusteriocontroller bootstrap create-admin <username>`");
		process.exit(1);
	}

	let secondSigint = false;
	process.on("SIGINT", () => {
		if (secondSigint) {
			setBlocking(true);
			logger.fatal("Caught second interrupt, terminating immediately");

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

export function bootstrap() {
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

if (module === require.main) {
	bootstrap();
}
