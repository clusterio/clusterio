/**
 * Command line interface for controlling a Clusterio cluster
 * @module
 */
const jwt = require("jsonwebtoken");
const fs = require("fs-extra");
const yargs = require("yargs");
const version = require("./package").version;
const asTable = require("as-table").configure({ delimiter: " | " });
const chalk = require("chalk");
const events = require("events");

const link = require("lib/link");
const errors = require("lib/errors");
const config = require("lib/config");


/**
 * Format a parsed Factorio output message with colors
 *
 * Formats a parsed Factorio output from lib/factorio into a readable
 * colorized output using terminal escape codes that can be printed.
 *
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
		if (level === "Info") {
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

/**
 * Represents a command that can be runned by clusterctl
 */
class Command {
	constructor({ definition, handler }) {
		this.name = definition[0];
		this._definition = definition;
		this._handler = handler;
	}

	register(yargs) {
		yargs.command(...this._definition);
	}

	async run(args, control) {
		await this._handler.call(this, args, control);
	}
}

/**
 * Resolve a string to an instance ID
 *
 * Resolves a string with either an instance name or an id into an integer
 * with the instance ID.
 *
 * @param client - link to master server to query instance on.
 * @param instanceName - string with name or id of instance.
 * @returns {number} instance ID.
 * @private
 */
async function resolveInstance(client, instanceName) {
	let instanceId;
	if (/^-?\d+$/.test(instanceName)) {
		instanceId = parseInt(instanceName, 10);
	} else {
		let response = await link.messages.listInstances.send(client);
		for (let instance of response.list) {
			if (instance.name === instanceName) {
				instanceId = instance.id;
				break;
			}
		}

		if (instanceId === undefined) {
			throw new errors.CommandError(`No instance named ${instanceName}`);
		}
	}

	return instanceId;
}

/**
 * Resolve a string into a slave ID
 *
 * Resolves a string with either an slave name or an id into an integer with
 * the slave ID.
 *
 * @param client - link to master server to query slave on.
 * @param slaveName - string with name or id of slave.
 * @returns {number} slave ID.
 * @private
 */
async function resolveSlave(client, slaveName) {
	let slaveId;
	if (/^-?\d+$/.test(slaveName)) {
		slaveId = parseInt(slaveName, 10);
	} else {
		let response = await link.messages.listSlaves.send(client);
		for (let slave of response.list) {
			if (slave.name === slaveName) {
				slaveId = slave.id;
				break;
			}
		}

		if (slaveId === undefined) {
			throw new errors.CommandError(`No slave named ${slaveName}`);
		}
	}

	return slaveId;
}

/**
 * Resolve a string into a role object
 *
 * Resolves a string with either a role name or an id into an object
 * representing the role.
 *
 * @param client - link to master server to query role on.
 * @param roleName - string with name or id of role.
 * @returns {Object} Role info.
 * @private
 */
async function resolveRole(client, roleName) {
	let response = await link.messages.listRoles.send(client);

	let resolvedRole;
	if (/^-?\d+$/.test(roleName)) {
		let roleId = parseInt(roleName, 10);
		for (let role of response.list) {
			if (role.id === roleId) {
				resolvedRole = role;
				break;
			}
		}

	} else {
		for (let role of response.list) {
			if (role.name === roleName) {
				resolvedRole = role;
				break;
			}
		}
	}

	if (!resolvedRole) {
		throw new errors.CommandError(`No role named ${roleName}`);
	}

	return resolvedRole;
}


let commands = [];
commands.push(new Command({
	definition: ["list-slaves", "List slaves connected to the master"],
	handler: async function(args, control) {
		let response = await link.messages.listSlaves.send(control);
		console.log(asTable(response.list));
	},
}));

commands.push(new Command({
	definition: ["generate-slave-token", "Generate token for a slave", (yargs) => {
		yargs.option("id", { type: "number", nargs: 1, describe: "Slave id", demandOption: true });
	}],
	handler: async function(args, control) {
		let response = await link.messages.generateSlaveToken.send(control, { slave_id: args.id });
		console.log(response.token);
	},
}));

commands.push(new Command({
	definition: ["create-slave-config", "Create slave config", (yargs) => {
		yargs.option("id", { type: "number", nargs: 1, describe: "Slave id", default: null });
		yargs.option("name", { type: "string", nargs: 1, describe: "Slave name", default: null });
		yargs.option("generate-token", {
			type: "boolean", nargs: 0, describe: "Generate authentication token", default: false
		});
		yargs.option("output", {
			type: "string", nargs: 1, describe: "Path to output config (- for stdout)", default: "config-slave.json"
		});
	}],
	handler: async function(args, control) {
		let response = await link.messages.createSlaveConfig.send(control, {
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
					throw new errors.CommandError(`File ${args.output} already exists`);
				}
				throw err;
			}
		}
	},
}));


commands.push(new Command({
	definition: ["list-instances", "List instances known to the master"],
	handler: async function(args, control) {
		let response = await link.messages.listInstances.send(control);
		console.log(asTable(response.list));
	}
}));

commands.push(new Command({
	definition: ["create-instance", "Create an instance", (yargs) => {
		// XXX TODO: set any specific options?
		yargs.option("name", {
			type: "string",
			nargs: 1,
			describe: "Instance name",
			group: "Instance Config:",
		});
		yargs.option("id", {
			type: "number",
			nargs: 1,
			describe: "Instance ID",
			group: "Instance Config:",
		});
		yargs.option("base", {
			type: "boolean",
			nargs: 0,
			describe: "Specify this is a base config",
			group: "Instance Config:"
		});
	}],
	handler: async function(args, control) {
		let instanceConfig = new config.InstanceConfig();
		await instanceConfig.init();
		if (args.id) {
			instanceConfig.set("instance.id", args.id);
		}
		if (args.name) {
			instanceConfig.set("instance.name", args.name);
		}
		let serialized_config = instanceConfig.serialize();
		let response = await link.messages.createInstance.send(control, { serialized_config });
	},
}));

commands.push(new Command({
	definition: ["list-instance-config", "List configuration for an instance", (yargs) => {
		yargs.option({
			"instance": { describe: "Instance to list config for", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await resolveInstance(control, args.instance);
		let response = await link.messages.getInstanceConfig.send(control, { instance_id: instanceId });

		for (let group of response.serialized_config.groups) {
			for (let [name, value] of Object.entries(group.fields)) {
				console.log(`${group.name}.${name} ${JSON.stringify(value)}`);
			}
		}
	},
}));

commands.push(new Command({
	definition: ["set-instance-config", "Set field in instance config", (yargs) => {
		yargs.option({
			"instance": { describe: "Instance to set config on", nargs: 1, type: "string", demandOption: true },
			"field": { describe: "Field to set", nargs: 1, type: "string", demandOption: true },
			"value": { describe: "Value to set", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await resolveInstance(control, args.instance);
		await link.messages.setInstanceConfigField.send(control, {
			instance_id: instanceId,
			field: args.field,
			value: args.value,
		});
	},
}));

commands.push(new Command({
	definition: ["set-instance-config-prop", "Set property of field in instance config", (yargs) => {
		yargs.option({
			"instance": { describe: "Instance to set config on", nargs: 1, type: "string", demandOption: true },
			"field": { describe: "Field to set", nargs: 1, type: "string", demandOption: true },
			"prop": { describe: "Property to set", nargs: 1, type: "string", demandOption: true },
			"value": { describe: "JSON parsed value to set", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await resolveInstance(control, args.instance);
		await link.messages.setInstanceConfigProp.send(control, {
			instance_id: instanceId,
			field: args.field,
			prop: args.prop,
			value: JSON.parse(args.value),
		});
	},
}));

commands.push(new Command({
	definition: ["assign-instance", "Assign instance to a slave", (yargs) => {
		yargs.options({
			"instance": { describe: "Instance to assign", nargs: 1, type: "string", demandOption: true },
			"slave": { describe: "Slave to assign to", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await resolveInstance(control, args.instance);
		let slaveId = await resolveSlave(control, args.slave);
		await link.messages.assignInstanceCommand.send(control, {
			instance_id: instanceId,
			slave_id: slaveId,
		});
	},
}));

commands.push(new Command({
	definition: ["create-save", "Create a new save on an instance", (yargs) => {
		yargs.options({
			"instance": { describe: "Instance to create on", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await resolveInstance(control, args.instance);
		await link.messages.setInstanceOutputSubscriptions.send(control, { instance_ids: [instanceId] });
		let response = await link.messages.createSave.send(control, {
			instance_id: instanceId,
		});
	},
}));

commands.push(new Command({
	definition: ["export-data", "Export item icons and locale from instance", (yargs) => {
		yargs.options({
			"instance": { describe: "Instance to export from", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await resolveInstance(control, args.instance);
		await link.messages.setInstanceOutputSubscriptions.send(control, { instance_ids: [instanceId] });
		let response = await link.messages.exportData.send(control, {
			instance_id: instanceId,
		});
	},
}));

commands.push(new Command({
	definition: ["start-instance", "Start instance", (yargs) => {
		yargs.options({
			"instance": { describe: "Instance to start", nargs: 1, type: "string", demandOption: true },
			"save": { describe: "Save load, defaults to latest", nargs: 1, type: "string" },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await resolveInstance(control, args.instance);
		await link.messages.setInstanceOutputSubscriptions.send(control, { instance_ids: [instanceId] });
		let response = await link.messages.startInstance.send(control, {
			instance_id: instanceId,
			save: args.save || null,
		});
	},
}));

commands.push(new Command({
	definition: ["stop-instance", "Stop instance", (yargs) => {
		yargs.options({
			"instance": { describe: "Instance to stop", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await resolveInstance(control, args.instance);
		await link.messages.setInstanceOutputSubscriptions.send(control, { instance_ids: [instanceId] });
		let response = await link.messages.stopInstance.send(control, {
			instance_id: instanceId,
		});
	},
}));

commands.push(new Command({
	definition: ["delete-instance", "Delete instance", (yargs) => {
		yargs.options({
			"instance": { describe: "Instance to delete", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let response = await link.messages.deleteInstance.send(control, {
			instance_id: await resolveInstance(control, args.instance),
		});
	},
}));

commands.push(new Command({
	definition: ["send-rcon", "Send RCON command", (yargs) => {
		yargs.options({
			"instance": { describe: "Instance to sent to", nargs: 1, type: "string", demandOption: true },
			"command": { describe: "command to send", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let response = await link.messages.sendRcon.send(control, {
			instance_id: await resolveInstance(control, args.instance),
			command: args.command
		});

		// Factorio includes a newline in it's response output.
		process.stdout.write(response.result);
	},
}));

commands.push(new Command({
	definition: ["list-permissions", "List permissions in the cluster"],
	handler: async function(args, control) {
		let response = await link.messages.listPermissions.send(control);
		console.log(asTable(response.list));
	},
}));

commands.push(new Command({
	definition: ["list-roles", "List roles in the cluster"],
	handler: async function(args, control) {
		let response = await link.messages.listRoles.send(control);
		console.log(asTable(response.list));
	},
}));

commands.push(new Command({
	definition: ["create-role", "Create a new role", (yargs) => {
		yargs.options({
			"name": { describe: "Name of role to create", nargs: 1, type: "string", demandOption: true },
			"description": { describe: "Description for role", nargs: 1, type: "string", default: "" },
			"permissions": { describe: "Permissions role grants", nargs: 1, array: true, type: "string", default: [] },
		});
	}],
	handler: async function(args, control) {
		let response = await link.messages.createRole.send(control, {
			name: args.name,
			description: args.description,
			permissions: args.permissions
		});
		console.log(`Created role ID ${response.id}`);
	},
}));

commands.push(new Command({
	definition: ["edit-role", "Edit existing role", (yargs) => {
		yargs.options({
			"role": { describe: "Role to edit", nargs: 1, type: "string", demandOption: true },
			"name": { describe: "New name for role", nargs: 1, type: "string" },
			"description": { describe: "New description for role", nargs: 1, type: "string" },
			"permissions": { describe: "New permissions for role", array: true, type: "string" },
			"grant-default": { describe: "Add default permissions to role", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args, control) {
		let role = await resolveRole(control, args.role);

		if (args.name !== undefined) {
			role.name = args.name;
		}
		if (args.description !== undefined) {
			role.description = args.description;
		}
		if (args.permissions !== undefined) {
			role.permissions = args.permissions;
		}
		await link.messages.updateRole.send(control, role);

		if (args.grantDefault) {
			await link.messages.grantDefaultRolePermissions.send(control, { id: role.id });
		}
	},
}));

commands.push(new Command({
	definition: ["delete-role", "Delete role", (yargs) => {
		yargs.options({
			"role": { describe: "Role to delete", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let role = await resolveRole(control, args.role);
		await link.messages.deleteRole.send(control, { id: role.id });
	},
}));


commands.push(new Command({
	definition: ["list-users", "List user in the cluster"],
	handler: async function(args, control) {
		let response = await link.messages.listUsers.send(control);
		console.log(asTable(response.list));
	},
}));

commands.push(new Command({
	definition: ["create-user", "Create a user", (yargs) => {
		yargs.options({
			"name": { describe: "Name of user to create", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		await link.messages.createUser.send(control, { name: args.name });
	},
}));

commands.push(new Command({
	definition: ["edit-user-roles", "Edit user roles", (yargs) => {
		yargs.options({
			"name": { describe: "Name of user to change roles for", nargs: 1, type: "string", demandOption: true },
			"roles": { describe: "roles to assign", array: true, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let response = await link.messages.listRoles.send(control);

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
					throw new errors.CommandError(`No role named ${roleName}`);
				}
			}
		}

		await link.messages.updateUserRoles.send(control, { name: args.name, roles: resolvedRoles });
	},
}));

commands.push(new Command({
	definition: ["delete-user", "Delete user", (yargs) => {
		yargs.options({
			"name": { describe: "Name of user to delete", nargs: 1, type: "string", demandOption: true },
		});
	}],
	handler: async function(args, control) {
		await link.messages.deleteUser.send(control, { name: args.name });
	},
}));

commands.push(new Command({
	definition: ["debug-dump-ws", "Dump WebSocket messages sent and received by master", (yargs) => { }],
	handler: async function(args, control) {
		await link.messages.debugDumpWs.send(control);
		return new Promise(() => {});
	},
}));

// Convert to mapping from name to command instance
commands = new Map([...commands.map(command => [command.name, command])]);


/**
 * Connector for control connection to master server
 * @private
 */
class ControlConnector extends link.WebSocketClientConnector {
	constructor(url, reconnectDelay, token) {
		super(url, reconnectDelay);
		this._token = token;
	}

	register() {
		console.log("SOCKET | registering control");
		this.sendHandshake("register_control", {
			token: this._token,
			agent: "clusterctl",
			version: version,
		});
	}
}

/**
 * Handles running the control
 *
 * Connects to the master server over WebSocket and sends commands to it.
 */
class Control extends link.Link {

	// I don't like God classes, but the alternative of putting all this state
	// into global variables is not much better.
	constructor(connector) {
		super("control", "master", connector);
		link.attachAllMessages(this);
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
			await link.messages.prepareDisconnect.send(this);
		} catch (err) {
			if (!(err instanceof errors.SessionLost)) {
				throw err;
			}
		}

		await this.connector.close(1001, "Control Quit");
	}
}


async function startControl() {
	yargs
		.scriptName("clusterctl")
		.usage("$0 <command> [options]")
		.option("config", {
			nargs: 1,
			describe: "config file to get credentails from",
			default: "config-control.json",
			defaultDescription: "auto",
			type: "string",
		})
		.command("control-config", "Manage Control config", config.configCommand)
		.wrap(yargs.terminalWidth())
	;

	for (let command of commands.values()) {
		command.register(yargs);
	}

	const args = yargs.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	config.finalizeConfigs();

	console.log(`Loading config from ${args.config}`);
	let controlConfig = new config.ControlConfig();
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

	let commandName = args._[0];
	if (commandName === "control-config") {
		await config.handleConfigCommand(args, controlConfig, args.config);
		return;
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
	let control = new Control(controlConnector);
	try {
		await controlConnector.connect();
	} catch(err) {
		if (err instanceof errors.AuthenticationFailed) {
			throw new errors.StartupError(err.message);
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

	if (commands.has(commandName)) {
		command = commands.get(commandName);

		try {
			await command.run(args, control);

		} catch (err) {
			if (err instanceof errors.CommandError) {
				console.error(`Error running command: ${err.message}`);
				process.exitCode = 1;

			} else if (err instanceof errors.RequestError) {
				console.error(`Error sending request: ${err.message}`);
				process.exitCode = 1;

			} else {
				throw err;
			}

		} finally {
			await control.shutdown();
		}
	}
}

module.exports = {
	// for testing only
	_formatOutputColored: formatOutputColored,
	_resolveInstance: resolveInstance,
	_Control: Control,

	_commands: commands,
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
		if (!(err instanceof errors.StartupError)) {
			console.error(`
+----------------------------------------------------------------+
| Unexpected error occured while starting control, please report |
| it to https://github.com/clusterio/factorioClusterio/issues    |
+----------------------------------------------------------------+`
			);
		} else {
			console.error(`
+-------------------------------+
| Unable to to start clusterctl |
+-------------------------------+`
			);
		}

		console.error(err);
		process.exitCode = 1;
	});
}
