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
import fs from "fs-extra";
import path from "path";
import yargs from "yargs";
import setBlocking from "set-blocking";
import { version } from "./package.json";
import winston from "winston";
import "winston-daily-rotate-file";

// internal libraries
import * as lib from "@clusterio/lib";
import { ConsoleTransport, levels, logger } from "@clusterio/lib";

import Host from "./src/Host";


export class HostConnector extends lib.WebSocketClientConnector {
	constructor(
		public hostConfig: lib.HostConfig,
		tlsCa: string | undefined,
		public pluginInfos: lib.PluginNodeEnvInfo[]
	) {
		super(
			hostConfig.get("host.controller_url"),
			hostConfig.get("host.max_reconnect_delay"),
			tlsCa
		);
	}

	register() {
		logger.info("Connector | registering host");
		let plugins: Record<string, string> = {};
		for (let pluginInfo of this.pluginInfos) {
			plugins[pluginInfo.name] = pluginInfo.version;
		}

		this.sendHandshake(
			new lib.MessageRegisterHost(
				new lib.RegisterHostData(
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
		.command("plugin", "Manage available plugins", lib.pluginCommand)
		.command("config", "Manage Host config", lib.configCommand)
		.command("run", "Run host")
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.parseSync()
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
			format: new lib.TerminalFormat(),
			filter: (info: any) => info.instance_id === undefined,
		}));
	}
	lib.handleUnhandledErrors();

	let command = args._[0];
	if (command === "run") {
		logger.info(`Starting Clusterio host ${version}`);
	}

	logger.info(`Loading available plugins from ${args.pluginList}`);
	let pluginList = new Map();
	try {
		pluginList = new Map(JSON.parse(await fs.readFile(args.pluginList, "utf8")));
	} catch (err: any) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	// If the command is plugin management we don't try to load plugins
	if (command === "plugin") {
		await lib.handlePluginCommand(args, pluginList, args.pluginList);
		return;
	}

	logger.info("Loading Plugin info");
	let pluginInfos = await lib.loadPluginInfos(pluginList);
	lib.registerPluginMessages(pluginInfos);
	lib.registerPluginConfigGroups(pluginInfos);
	lib.finalizeConfigs();

	logger.info(`Loading config from ${args.config}`);
	let hostConfig = new lib.HostConfig("host");
	try {
		await hostConfig.load(JSON.parse(await fs.readFile(args.config, "utf8")));

	} catch (err: any) {
		if (err.code === "ENOENT") {
			logger.info("Config not found, initializing new config");
			await hostConfig.init();

		} else {
			throw new lib.StartupError(`Failed to load ${args.config}: ${err.message}`);
		}
	}

	if (command === "config") {
		await lib.handleConfigCommand(args, hostConfig, args.config);
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

	let tlsCa: string | undefined;
	let tlsCaPath = hostConfig.get("host.tls_ca");
	if (tlsCaPath) {
		tlsCa = await fs.readFile(tlsCaPath, "utf8");
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
		logger.add(new lib.LinkTransport({ link: host }));
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
		if (err instanceof lib.AuthenticationFailed) {
			logger.fatal(err.message);

		} else if (err instanceof lib.StartupError) {
			logger.fatal(`
+----------------------------------+
| Unable to to start clusteriohost |
+----------------------------------+
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
| Unexpected error occured while starting host, please       |
| report it to https://github.com/clusterio/clusterio/issues |
+------------------------------------------------------------+
${err.stack}`
			);
		}

		process.exitCode = 1;
	});
}
