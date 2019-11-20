const io = require("socket.io-client");
const jwt = require("jsonwebtoken");
const fs = require("fs-extra");
const yargs = require("yargs");
const version = require("./package").version;
const asTable = require("as-table").configure({delimiter: ' | '});

const link = require("lib/link");
const errors = require("lib/errors");


/**
 * Represens a command that can be runned by clusterctl
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
 * @param link - link to master server to query instance on.
 * @param instance - string with name or id of instance.
 * @returns {number} instance ID.
 */
async function resolveInstance(control, instanceName) {
	let instanceId;
	if (/^-?\d+$/.test(instanceName)) {
		instanceId = parseInt(instanceName, 10);
	} else {
		let response = await link.requests.listInstances.send(control);
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

let commands = [];
commands.push(new Command({
	definition: ["list-slaves", "List slaves connected to the master"],
	handler: async function(args, control) {
		let response = await link.requests.listSlaves.send(control);
		console.log(asTable(response.list));
	},
}));

commands.push(new Command({
	definition: ["list-instances", "List instances known to the master"],
	handler: async function(args, control) {
		let response = await link.requests.listInstances.send(control);
		console.log(asTable(response.list));
	}
}));

commands.push(new Command({
	definition: ['create-instance', "Create an instance", (yargs) => {
		yargs.options({
			'name': { describe: "Name of the instance", nargs: 1, type: 'string', demandOption: true },
			'slave': { describe: "Slave to create on", nargs: 1, type: 'string', demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let slaveId;
		if (/^-?\d+$/.test(args.slave)) {
			slaveId = parseInt(args.slave, 10);
		} else {
			let response = await link.requests.listSlaves.send(control);
			for (let slave of response.list) {
				if (slave.name === args.slave) {
					slaveId = slave.id;
					break;
				}
			}

			if (slaveId === undefined) {
				throw new errors.CommandError(`No slave named ${args.slave}`);
			}
		}
		let response = await link.requests.createInstanceCommand.send(control, {
			name: args.name,
			slave_id: slaveId,
		});
		console.log(response);
	},
}));

commands.push(new Command({
	definition: ['create-save', "Create a new save on an instance", (yargs) => {
		yargs.options({
			'instance': { describe: "Instance to create on", nargs: 1, type: 'string', demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let response = await link.requests.createSave.send(control, {
			instance_id: await resolveInstance(control, args.instance),
		});
		console.log(response);
	},
}));

commands.push(new Command({
	definition: ['start-instance', "Start instance", (yargs) => {
		yargs.options({
			'instance': { describe: "Instance to start", nargs: 1, type: 'string', demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let response = await link.requests.startInstance.send(control, {
			instance_id: await resolveInstance(control, args.instance),
		});
		console.log(response);
	},
}));

commands.push(new Command({
	definition: ['stop-instance', "Stop instance", (yargs) => {
		yargs.options({
			'instance': { describe: "Instance to stop", nargs: 1, type: 'string', demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let response = await link.requests.stopInstance.send(control, {
			instance_id: await resolveInstance(control, args.instance),
		});
		console.log(response);
	},
}));

commands.push(new Command({
	definition: ['delete-instance', "Delete instance", (yargs) => {
		yargs.options({
			'instance': { describe: "Instance to delete", nargs: 1, type: 'string', demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let response = await link.requests.deleteInstance.send(control, {
			instance_id: await resolveInstance(control, args.instance),
		});
		console.log(response);
	},
}));

commands.push(new Command({
	definition: ['send-rcon', "Send RCON command", (yargs) => {
		yargs.options({
			'instance': { describe: "Instance to sent to", nargs: 1, type: 'string', demandOption: true },
			'command': { describe: "command to send", nargs: 1, type: 'string', demandOption: true },
		});
	}],
	handler: async function(args, control) {
		let response = await link.requests.sendRcon.send(control, {
			instance_id: await resolveInstance(control, args.instance),
			command: args.command
		})

		// Factorio includes a newline in it's response output.
		process.stdout.write(response.result);
	},
}));

// Convert to mapping from name to command instance
commands = new Map([...commands.map(command => [command.name, command])]);


/**
 * Handles running the control
 *
 * Connects to the master server over the socket.io connection and sends
 * commands to it.
 */
class Control extends link.Client {

	// I don't like God classes, but the alternative of putting all this state
	// into global variables is not much better.
	constructor(controlConfig) {
		super('control', controlConfig.url, controlConfig.token);
		link.attachAllMessages(this);
	}

	register() {
		console.log("SOCKET | registering control");
		this.send('register_control', {
			agent: 'clusterctl',
			version: version,
		});
	}
}

async function findCredentials() {
	// Try looking in the default master config location
	try {
		let masterConfig = JSON.parse(await fs.readFile("config.json"));
		let token = jwt.sign({ id: "api" }, masterConfig.masterAuthSecret, { expiresIn: 600 });

		let url;
		if (masterConfig.sslPort) {
			url = `https://localhost:${masterConfig.sslPort}`;
		} else {
			url = `http://localhost:${masterConfig.masterPort}`;
		}

		return { url, token };

	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	// Try looking in the default slave config location
	// In the future it's likely that tokens will be assigned more granular
	// authorizations, meaning that you cannot use a slave token to control
	// the cluster.
	try {
		let slaveConfig = JSON.parse(await fs.readFile("config-slave.json"));
		return {
			url: slaveConfig.masterURL,
			token: slaveConfig.masterAuthToken,
		}

	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	throw new errors.StartupError("Couldn't find credentials to connect to the master server with");
}


async function startControl() {
	yargs
		.scriptName("clusterctl")
		.usage("$0 <command> [options]")
		.option('config', {
			nargs: 1,
			describe: "config file to get credentails from",
			default: "config-control.json",
			defaultDescription: "auto",
			type: 'string',
		})
		.command('create-config', "Create control config", (yargs) => {
			yargs.options({
				'url': { describe: "Master URL", nargs: 1, type: 'string', default: "http://localhost:8080/" },
				'token': { describe: "Master token", nargs: 1, type: 'string', demandOption: true },
			});
		})
		.command('edit-config', "Edit control config", (yargs) => {
			yargs.options({
				'url': { describe: "Set master URL", nargs: 1, type: 'string' },
				'token': { describe: "Set master token", nargs: 1, type: 'string' },
			});
		})
		.command('show-config', "Show control config")
	;

	for (let command of commands.values()) {
		command.register(yargs);
	}

	const args = yargs.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	let commandName = args._[0];
	if (commandName === "create-config") {
		await fs.outputFile(args.config, JSON.stringify({
			url: args.url,
			token: args.token,
		}, null, 4), { flag: 'wx' });
		return;

	} else if (commandName === "edit-config") {
		let controlConfig = JSON.parse(await fs.readFile(args.config));
		if ('url' in args) controlConfig.url = args.url;
		if ('token' in args) controlConfig.token = args.token;
		await fs.outputFile(args.config, JSON.stringify(controlConfig, null, 4));
		return;

	} else if (commandName === "show-config") {
		let controlConfig = JSON.parse(await fs.readFile(args.config));
		console.log(controlConfig);
		return;
	}

	// The remaining commands require connecting to the master server.
	let controlConfig;
	try {
		controlConfig = JSON.parse(await fs.readFile(args.config));
	} catch (err) {
		if (err.code === "ENOENT") {
			controlConfig = await findCredentials();
		} else {
			throw err;
		}
	}

	let control = new Control(controlConfig);
	await control.connect();

	if (commands.has(commandName)) {
		command = commands.get(commandName);

		try {
			await command.run(args, control)

		} catch (err) {
			if (err instanceof errors.CommandError) {
				console.error(`Error running command: ${err.message}`);
				process.exitCode = 1;

			} else if (err instanceof errors.RequestError) {
				console.error(`Error sending request: ${err.message}`);
				process.exitCode = 1;

			} else {
				control.close("error");
				throw err;
			}
		}

		control.close("quit");
		return; // ??
	}

	//XXX control.close("done");
}


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
