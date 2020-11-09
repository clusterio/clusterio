#!/usr/bin/env node

/**
 * Command line interface for controlling a Clusterio cluster
 * @module ctl/ctl
 */
"use strict";
const fs = require("fs-extra");
const yargs = require("yargs");
const version = require("./package").version;
const asTable = require("as-table").configure({ delimiter: " | " });
const chalk = require("chalk");
const events = require("events");
const path = require("path");

const libLink = require("@clusterio/lib/link");
const libErrors = require("@clusterio/lib/errors");
const libConfig = require("@clusterio/lib/config");
const libPlugin = require("@clusterio/lib/plugin");
const libPluginLoader = require("@clusterio/lib/plugin_loader");
const libCommand = require("@clusterio/lib/command");
const libSharedCommands = require("@clusterio/lib/shared_commands");


/**
 * Format a parsed Factorio output message with colors
 *
 * Formats a parsed Factorio output from lib/factorio into a readable
 * colorized output using terminal escape codes that can be printed.
 *
 * @param {Object} output - Factorio server output.
 * @returns {string} terminal colorized message.
 * @private
 */
function formatOutputColored(output) {
	let time = "";
	if (output.format === "seconds") {
		time = chalk.yellow(output.time.padStart(8)) + " ";
	} else if (output.format === "date") {
		time = chalk.yellow(output.time) + " ";
	}

	let info = "";
	if (output.type === "log") {
		let level = output.level;
		if (level === "Script") {
			level = chalk.bold.greenBright(level);
		} else if (level === "Verbose") {
			level = chalk.bold.gray(level);
		} else if (level === "Info") {
			level = chalk.bold.blueBright(level);
		} else if (output.level === "Warning") {
			level = chalk.bold.yellowBright(level);
		} else if (output.level === "Error") {
			level = chalk.bold.redBright(level);
		}

		info = level + " " + chalk.gray(output.file) + ": ";

	} else if (output.type === "action") {
		info = "[" + chalk.yellow(output.action) + "] ";
	}

	return time + info + output.message;
}

const slaveCommands = new libCommand.CommandTree({ name: "slave", description: "Slave management" });
slaveCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List slaves connected to the master"],
	handler: async function(args, control) {
		let response = await libLink.messages.listSlaves.send(control);
		console.log(asTable(response.list));
	},
}));

slaveCommands.add(new libCommand.Command({
	definition: ["generate-token", "Generate token for a slave", (yargs) => {
		yargs.option("id", { type: "number", nargs: 1, describe: "Slave id", demandOption: true });
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.generateSlaveToken.send(control, { slave_id: args.id });
		console.log(response.token);
	},
}));

slaveCommands.add(new libCommand.Command({
	definition: ["create-config", "Create slave config", (yargs) => {
		yargs.option("id", { type: "number", nargs: 1, describe: "Slave id", default: null });
		yargs.option("name", { type: "string", nargs: 1, describe: "Slave name", default: null });
		yargs.option("generate-token", {
			type: "boolean", nargs: 0, describe: "Generate authentication token", default: false,
		});
		yargs.option("output", {
			type: "string", nargs: 1, describe: "Path to output config (- for stdout)", default: "config-slave.json",
		});
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.createSlaveConfig.send(control, {
			id: args.id, name: args.name, generate_token: args.generateToken,
		});

		let content = JSON.stringify(response.serialized_config, null, 4);
		if (args.output === "-") {
			console.log(content);
		} else {
			console.log(`Writing ${args.output}`);
			try {
				await fs.outputFile(args.output, content, { flag: "wx" });
			} catch (err) {
				if (err.code === "EEXIST") {
					throw new libErrors.CommandError(`File ${args.output} already exists`);
				}
				throw err;
			}
		}
	},
}));


const instanceCommands = new libCommand.CommandTree({
	name: "instance", alias: ["i"], description: "Instance management",
});
instanceCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List instances known to the master"],
	handler: async function(args, control) {
		let response = await libLink.messages.listInstances.send(control);
		console.log(asTable(response.list));
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["create <name>", "Create an instance", (yargs) => {
		// XXX TODO: set any specific options?
		yargs.positional("name", { describe: "Instance name", type: "string" });
		yargs.options({
			"id": { type: "number", nargs: 1, describe: "Instance id" },
		});
	}],
	handler: async function(args, control) {
		let instanceConfig = new libConfig.InstanceConfig();
		await instanceConfig.init();
		if (args.id) {
			instanceConfig.set("instance.id", args.id);
		}
		instanceConfig.set("instance.name", args.name);
		let serialized_config = instanceConfig.serialize();
		let response = await libLink.messages.createInstance.send(control, { serialized_config });
	},
}));

const instanceConfigCommands = new libCommand.CommandTree({
	name: "config", alias: ["c"], description: "Instance config management",
});
instanceConfigCommands.add(new libCommand.Command({
	definition: ["list <instance>", "List configuration for an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to list config for", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let response = await libLink.messages.getInstanceConfig.send(control, { instance_id: instanceId });

		for (let group of response.serialized_config.groups) {
			for (let [name, value] of Object.entries(group.fields)) {
				console.log(`${group.name}.${name} ${JSON.stringify(value)}`);
			}
		}
	},
}));

instanceConfigCommands.add(new libCommand.Command({
	definition: ["set <instance> <field> <value>", "Set field in instance config", (yargs) => {
		yargs.positional("instance", { describe: "Instance to set config on", type: "string" });
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("value", { describe: "Value to set", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await libLink.messages.setInstanceConfigField.send(control, {
			instance_id: instanceId,
			field: args.field,
			value: args.value,
		});
	},
}));

instanceConfigCommands.add(new libCommand.Command({
	definition: ["set-prop <instance> <field> <prop> <value>", "Set property of field in instance config", (yargs) => {
		yargs.positional("instance", { describe: "Instance to set config on", type: "string" });
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("prop", { describe: "Property to set", type: "string" });
		yargs.positional("value", { describe: "JSON parsed value to set", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await libLink.messages.setInstanceConfigProp.send(control, {
			instance_id: instanceId,
			field: args.field,
			prop: args.prop,
			value: JSON.parse(args.value),
		});
	},
}));
instanceCommands.add(instanceConfigCommands);

instanceCommands.add(new libCommand.Command({
	definition: ["assign <instance> <slave>", "Assign instance to a slave", (yargs) => {
		yargs.positional("instance", { describe: "Instance to assign", type: "string" });
		yargs.positional("slave", { describe: "Slave to assign to", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let slaveId = await libCommand.resolveSlave(control, args.slave);
		await libLink.messages.assignInstanceCommand.send(control, {
			instance_id: instanceId,
			slave_id: slaveId,
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["create-save <instance>", "Create a new save on an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to create on", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await libLink.messages.setInstanceOutputSubscriptions.send(control, { instance_ids: [instanceId] });
		let response = await libLink.messages.createSave.send(control, {
			instance_id: instanceId,
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["export-data <instance>", "Export item icons and locale from instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to export from", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await libLink.messages.setInstanceOutputSubscriptions.send(control, { instance_ids: [instanceId] });
		let response = await libLink.messages.exportData.send(control, {
			instance_id: instanceId,
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["start <instance>", "Start instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to start", type: "string" });
		yargs.options({
			"save": { describe: "Save load, defaults to latest", nargs: 1, type: "string" },
			"keep-open": { describe: "Keep console open", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await libLink.messages.setInstanceOutputSubscriptions.send(control, { instance_ids: [instanceId] });
		let response = await libLink.messages.startInstance.send(control, {
			instance_id: instanceId,
			save: args.save || null,
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["load-scenario <instance> <scenario>", "Start instance by loading a scenario", (yargs) => {
		yargs.positional("instance", { describe: "Instance to start", type: "string" });
		yargs.positional("scenario", { describe: "Scenario to load", type: "string" });
		yargs.options({
			"keep-open": { describe: "Keep console open", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await libLink.messages.setInstanceOutputSubscriptions.send(control, { instance_ids: [instanceId] });
		let response = await libLink.messages.loadScenario.send(control, {
			instance_id: instanceId,
			scenario: args.scenario || null,
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["stop <instance>", "Stop instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to stop", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await libLink.messages.setInstanceOutputSubscriptions.send(control, { instance_ids: [instanceId] });
		let response = await libLink.messages.stopInstance.send(control, {
			instance_id: instanceId,
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["delete <instance>", "Delete instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to delete", type: "string" });
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.deleteInstance.send(control, {
			instance_id: await libCommand.resolveInstance(control, args.instance),
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["send-rcon <instance> <command>", "Send RCON command", (yargs) => {
		yargs.positional("instance", { describe: "Instance to send to", type: "string" });
		yargs.positional("command", { describe: "command to send", type: "string" });
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.sendRcon.send(control, {
			instance_id: await libCommand.resolveInstance(control, args.instance),
			command: args.command,
		});

		// Factorio includes a newline in it's response output.
		process.stdout.write(response.result);
	},
}));

const permissionCommands = new libCommand.CommandTree({ name: "permission", description: "Permission inspection" });
permissionCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List permissions in the cluster"],
	handler: async function(args, control) {
		let response = await libLink.messages.listPermissions.send(control);
		console.log(asTable(response.list));
	},
}));


const roleCommands = new libCommand.CommandTree({ name: "role", description: "Role management" });
roleCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List roles in the cluster"],
	handler: async function(args, control) {
		let response = await libLink.messages.listRoles.send(control);
		console.log(asTable(response.list));
	},
}));

roleCommands.add(new libCommand.Command({
	definition: ["create <name>", "Create a new role", (yargs) => {
		yargs.positional("name", { describe: "Name of role to create", type: "string" });
		yargs.options({
			"description": { describe: "Description for role", nargs: 1, type: "string", default: "" },
			"permissions": { describe: "Permissions role grants", nargs: 1, array: true, type: "string", default: [] },
		});
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.createRole.send(control, {
			name: args.name,
			description: args.description,
			permissions: args.permissions,
		});
		console.log(`Created role ID ${response.id}`);
	},
}));

roleCommands.add(new libCommand.Command({
	definition: ["edit <role>", "Edit existing role", (yargs) => {
		yargs.positional("role", { describe: "Role to edit", type: "string" });
		yargs.options({
			"name": { describe: "New name for role", nargs: 1, type: "string" },
			"description": { describe: "New description for role", nargs: 1, type: "string" },
			"permissions": { describe: "New permissions for role", array: true, type: "string" },
			"grant-default": { describe: "Add default permissions to role", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args, control) {
		let role = await libCommand.retrieveRole(control, args.role);

		if (args.name !== undefined) {
			role.name = args.name;
		}
		if (args.description !== undefined) {
			role.description = args.description;
		}
		if (args.permissions !== undefined) {
			role.permissions = args.permissions;
		}
		await libLink.messages.updateRole.send(control, role);

		if (args.grantDefault) {
			await libLink.messages.grantDefaultRolePermissions.send(control, { id: role.id });
		}
	},
}));

roleCommands.add(new libCommand.Command({
	definition: ["delete <role>", "Delete role", (yargs) => {
		yargs.positional("role", { describe: "Role to delete", type: "string" });
	}],
	handler: async function(args, control) {
		let role = await libCommand.retrieveRole(control, args.role);
		await libLink.messages.deleteRole.send(control, { id: role.id });
	},
}));


const userCommands = new libCommand.CommandTree({ name: "user", alias: ["u"], description: "User management" });
userCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List user in the cluster"],
	handler: async function(args, control) {
		let response = await libLink.messages.listUsers.send(control);
		console.log(asTable(response.list));
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["create <name>", "Create a user", (yargs) => {
		yargs.positional("name", { describe: "Name of user to create", type: "string" });
	}],
	handler: async function(args, control) {
		await libLink.messages.createUser.send(control, { name: args.name });
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["set-admin <user>", "Promote or demote a user to admin", (yargs) => {
		yargs.positional("user", { describe: "Name of user set admin status for", type: "string" });
		yargs.options({
			"revoke": { describe: "Revoke admin status", nargs: 0, type: "boolean", default: false },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		await libLink.messages.setUserAdmin.send(control, {
			name: args.user, create: args.create, admin: !args.revoke,
		});
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["set-whitelisted <user>", "Add or remove user from the whitelist", (yargs) => {
		yargs.positional("user", { describe: "Name of user to set whitelist status for", type: "string" });
		yargs.options({
			"remove": { describe: "Remove from whitelist", nargs: 0, type: "boolean", default: false },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		await libLink.messages.setUserWhitelisted.send(control, {
			name: args.user, create: args.create, whitelisted: !args.remove,
		});
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["set-banned <user>", "Ban or pardon user from banlist", (yargs) => {
		yargs.positional("user", { describe: "Name of user to set ban status for", type: "string" });
		yargs.options({
			"pardon": { describe: "Remove from banlist", nargs: 0, type: "boolean", default: false },
			"reason": { describe: "Ban reason", nargs: 1, type: "string", default: "" },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		await libLink.messages.setUserBanned.send(control, {
			name: args.user, create: args.create, banned: !args.pardon, reason: args.reason,
		});
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["set-roles <user> [roles...]", "Replace user roles", (yargs) => {
		yargs.positional("user", { describe: "Name of user to change roles for", type: "string" });
		yargs.positional("roles", { describe: "roles to assign", type: "string" });
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.listRoles.send(control);

		let resolvedRoles = [];
		for (let roleName of args.roles) {
			if (/^-?\d+$/.test(roleName)) {
				let roleId = parseInt(roleName, 10);
				resolvedRoles.push(roleId);

			} else {
				let found = false;
				for (let role of response.list) {
					if (role.name === roleName) {
						resolvedRoles.push(role.id);
						found = true;
						break;
					}
				}

				if (!found) {
					throw new libErrors.CommandError(`No role named ${roleName}`);
				}
			}
		}

		await libLink.messages.updateUserRoles.send(control, { name: args.user, roles: resolvedRoles });
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["delete <user>", "Delete user", (yargs) => {
		yargs.positional("user", { describe: "Name of user to delete", type: "string" });
	}],
	handler: async function(args, control) {
		await libLink.messages.deleteUser.send(control, { name: args.user });
	},
}));

const debugCommands = new libCommand.CommandTree({ name: "debug", description: "Debugging utilities" });
debugCommands.add(new libCommand.Command({
	definition: ["dump-ws", "Dump WebSocket messages sent and received by master", (yargs) => { }],
	handler: async function(args, control) {
		await libLink.messages.debugDumpWs.send(control);
		return new Promise(() => {});
	},
}));


/**
 * Connector for control connection to master server
 * @private
 */
class ControlConnector extends libLink.WebSocketClientConnector {
	constructor(url, reconnectDelay, token) {
		super(url, reconnectDelay);
		this._token = token;
	}

	register() {
		console.log("SOCKET | registering control");
		this.sendHandshake("register_control", {
			token: this._token,
			agent: "clusterioctl",
			version: version,
		});
	}
}

/**
 * Handles running the control
 *
 * Connects to the master server over WebSocket and sends commands to it.
 * @static
 */
class Control extends libLink.Link {

	constructor(connector, controlPlugins) {
		super("control", "master", connector);
		libLink.attachAllMessages(this);

		/**
		 * Mapping of plugin names to their instance for loaded plugins.
		 * @type {Map<string, module:lib/plugin.BaseControlPlugin>}
		 */
		this.plugins = controlPlugins;
		for (let controlPlugin of controlPlugins.values()) {
			libPlugin.attachPluginMessages(this, controlPlugin.info, controlPlugin);
		}
	}

	async instanceOutputEventHandler(message) {
		let { instance_id, output } = message.data;
		console.log(formatOutputColored(output));
	}

	async debugWsMessageEventHandler(message) {
		console.log("WS", message.data.direction, message.data.content);
	}

	async shutdown() {
		this.connector.setTimeout(30);

		try {
			await libLink.messages.prepareDisconnect.send(this);
		} catch (err) {
			if (!(err instanceof libErrors.SessionLost)) {
				throw err;
			}
		}

		await this.connector.close(1001, "Control Quit");
	}
}


async function startControl() {
	yargs
		.scriptName("clusterioctl")
		.usage("$0 <command> [options]")
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
		.command("plugin", "Manage available plugins", libSharedCommands.pluginCommand)
		.command("control-config", "Manage Control config", libSharedCommands.configCommand)
		.wrap(yargs.terminalWidth())
		.help(false) // Disable help to avoid triggering it on the first parse.
	;

	// Parse the args first to get the configured plugin list.
	let args = yargs.argv;

	console.log(`Loading available plugins from ${args.pluginList}`);
	let pluginList = new Map();
	try {
		pluginList = new Map(JSON.parse(await fs.readFile(args.pluginList)));
	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	// If the command is plugin management we don't try to load plugins
	if (args._[0] === "plugin") {
		await libSharedCommands.handlePluginCommand(args, pluginList, args.pluginList);
		return;
	}

	// Add all cluster management commands including ones from plugins
	const rootCommands = new libCommand.CommandTree({ name: "clusterioctl", description: "Manage cluster" });
	rootCommands.add(slaveCommands);
	rootCommands.add(instanceCommands);
	rootCommands.add(permissionCommands);
	rootCommands.add(roleCommands);
	rootCommands.add(userCommands);
	rootCommands.add(debugCommands);

	console.log("Loading Plugin info");
	let pluginInfos = await libPluginLoader.loadPluginInfos(pluginList);
	libConfig.registerPluginConfigGroups(pluginInfos);
	libConfig.finalizeConfigs();

	let controlPlugins = new Map();
	for (let pluginInfo of pluginInfos) {
		if (!pluginInfo.controlEntrypoint) {
			continue;
		}

		let { ControlPlugin } = require(path.posix.join(pluginInfo.requirePath, pluginInfo.controlEntrypoint));
		let controlPlugin = new ControlPlugin(pluginInfo);
		controlPlugins.set(pluginInfo.name, controlPlugin);
		await controlPlugin.init();
		await controlPlugin.addCommands(rootCommands);
	}

	for (let [name, command] of rootCommands.subCommands) {
		if (name === command.name) {
			command.register(yargs);
		}
	}

	// Reparse after commands have been added with help and strict checking.
	args = yargs
		.help()
		.strict()
		.argv
	;

	console.log(`Loading config from ${args.config}`);
	let controlConfig = new libConfig.ControlConfig();
	try {
		await controlConfig.load(JSON.parse(await fs.readFile(args.config)));

	} catch (err) {
		if (err.code === "ENOENT") {
			console.log("Config not found, initializing new config");
			await controlConfig.init();

		} else {
			throw err;
		}
	}

	if (args._.length === 0) {
		yargs.showHelp();
		yargs.exit();
	}

	// Handle the control-config command before trying to connect.
	if (args._[0] === "control-config") {
		await libSharedCommands.handleConfigCommand(args, controlConfig, args.config);
		return;
	}

	// Determine which command is being executed.
	let commandPath = [...args._];
	let targetCommand = rootCommands;
	while (commandPath.length && targetCommand instanceof libCommand.CommandTree) {
		targetCommand = targetCommand.get(commandPath.shift());
	}

	// The remaining commands require connecting to the master server.
	if (!controlConfig.get("control.master_url") || !controlConfig.get("control.master_token")) {
		console.error("Missing URL and/or token to connect with.  See README.md for setting up access.");
		process.exitCode = 1;
		return;
	}

	let controlConnector = new ControlConnector(
		controlConfig.get("control.master_url"),
		controlConfig.get("control.reconnect_delay"),
		controlConfig.get("control.master_token")
	);
	let control = new Control(controlConnector, controlPlugins);
	try {
		await controlConnector.connect();
	} catch(err) {
		if (err instanceof libErrors.AuthenticationFailed) {
			throw new libErrors.StartupError(err.message);
		}
		throw err;
	}

	process.on("SIGINT", () => {
		console.log("Caught interrupt signal, closing connection");
		control.shutdown().catch(err => {
			console.error(err);
			process.exit(1);
		});
	});

	let keepOpen = Boolean(args.keepOpen);
	try {
		await targetCommand.run(args, control);

	} catch (err) {
		keepOpen = false;
		if (err instanceof libErrors.CommandError) {
			console.error(`Error running command: ${err.message}`);
			process.exitCode = 1;

		} else if (err instanceof libErrors.RequestError) {
			console.error(`Error sending request: ${err.message}`);
			process.exitCode = 1;

		} else {
			throw err;
		}

	} finally {
		if (!keepOpen) {
			await control.shutdown();
		}
	}
}

module.exports = {
	Control,

	// for testing only
	_formatOutputColored: formatOutputColored,
};


if (module === require.main) {
	console.warn(`
+==========================================================+
I WARNING:  This is the development branch for the 2.0     I
I           version of clusterio.  Expect things to break. I
+==========================================================+
`
	);
	startControl().catch(err => {
		if (!(err instanceof libErrors.StartupError)) {
			console.error(`
+----------------------------------------------------------------+
| Unexpected error occured while starting control, please report |
| it to https://github.com/clusterio/factorioClusterio/issues    |
+----------------------------------------------------------------+`
			);
		} else {
			console.error(`
+---------------------------------+
| Unable to to start clusterioctl |
+---------------------------------+`
			);
		}

		console.error(err);
		process.exitCode = 1;
	});
}
