/**
 * Command library
 *
 * Data types and utilites for commands to clusterioctl's CLI.
 *
 * @author Hornwitser
 * @module lib/command
 */
"use strict";
const libData = require("./data");
const libLink = require("./link");
const libErrors = require("./errors");

/**
 * Represents a command that can be runned by clusterioctl
 * @static
 */
class Command {
	/**
	 * Define an executable command.
	 *
	 * @param {Object} cmd - Command definiton.
	 * @param {Array} cmd.definiton -
	 *     Arguments to pass to yargs .command method to define this
	 *     command.
	 * @param {function(args, control)} handler -
	 *     Async function invoked when the command is executed.  Is given
	 *     the parsed args and a reference to the {@link
	 *     module:ctl/ctl.Control} instance.
	 */
	constructor({ definition, handler }) {
		if (definition[0] instanceof Array) {
			this.name = definition[0][0].split(" ")[0];
			this.alias = definition[0].slice(1);
		} else {
			this.name = definition[0].split(" ")[0];
			this.alias = [];
		}
		this._definition = definition;
		this._handler = handler;
	}

	register(yargs) {
		yargs.command(...this._definition);
	}

	async run(args, control) {
		await this._handler(args, control);
	}
}

/**
 * A node in the command tree that can hold commands and sub trees
 *
 * Container which can contain {@link module:lib/command.Command}s and other
 * CommandTrees.  This is used by clusterioctl to hold the full tree of
 * available commands, you may extend this tree by using a control plugin,
 * see {@link module:lib/plugin.BaseControlPlugin#addCommands}
 *
 * @static
 */
class CommandTree {
	/**
	 * Define a command containing sub commands.
	 *
	 * @param {Object} cmd - Command definition
	 * @param {string} cmd.name - Name of the command.
	 * @param {Array<string>} cmd.alias - Aliases for this tree.
	 * @param {description} cmd.description -
	 *     Descripton to provide for this command tree node.
	 */
	constructor({ name, alias, description }) {
		if (typeof name !== "string") {
			throw new Error("name must be a string");
		}

		this.name = name;
		this.alias = alias || [];
		this.description = description;
		this.subCommands = new Map();
	}

	/**
	 * Add a command or command tree to this tree
	 *
	 * @param {module:lib/command.Command|module:lib/command.CommandTree} command -
	 *    The command to add to this command tree.
	 */
	add(command) {
		if (this.subCommands.has(command.name)) {
			throw new Error(`Command ${command.name} already exists`);
		}
		this.subCommands.set(command.name, command);
		for (let alias of command.alias) {
			if (this.subCommands.has(alias)) {
				throw new Error(`Alias ${alias} for command ${command.name} already exists`);
			}
			this.subCommands.set(alias, command);
		}
	}

	/**
	 * Get a command or command tree from this tree
	 *
	 * @param {string} name -
	 *     The name of the command or command tree to retrieve.
	 * @return {?module:lib/command.Command|module:lib/command.CommandTree}
	 *    The command to add to this command tree.
	 */
	get(name) {
		return this.subCommands.get(name) || null;
	}

	/**
	 * Insert the registered commands into the given yargs parser
	 *
	 * Traverses the the tree of sub-commands recursively and adds all of
	 * them to the given yargs parser.
	 *
	 * @param {Object} yargs - yargs parser to register with.
	 */
	register(yargs) {
		yargs.command([this.name].concat(this.alias), this.description, (yargs) => {
			for (let [name, command] of this.subCommands) {
				// Check if the entry is not an alias.
				if (name === command.name) {
					command.register(yargs);
				}
			}
		}, () => {
			yargs.showHelp();
			yargs.exit();
		});
	}
}


/**
 * Resolve a string into a host ID
 *
 * Resolves a string with either an host name or an id into an integer with
 * the host ID.
 *
 * @param {module:lib/link.Link} client - link to controller to query host on.
 * @param {string} hostName - string with name or id of host.
 * @returns {Promise<number>} host ID.
 * @static
 */
async function resolveHost(client, hostName) {
	let hostId;
	if (/^-?\d+$/.test(hostName)) {
		hostId = parseInt(hostName, 10);
	} else {
		let hosts = await client.sendTo("controller", new libData.HostListRequest());
		for (let host of hosts) {
			if (host.name === hostName) {
				hostId = host.id;
				break;
			}
		}

		if (hostId === undefined) {
			throw new libErrors.CommandError(`No host named ${hostName}`);
		}
	}

	return hostId;
}

/**
 * Resolve a string to an instance ID
 *
 * Resolves a string with either an instance name or an id into an integer
 * with the instance ID.
 *
 * @param {module:lib/link.Link} client - link to controller to query instance on.
 * @param {string} instanceName - string with name or id of instance.
 * @returns {Promise<number>} instance ID.
 * @static
 */
async function resolveInstance(client, instanceName) {
	let instanceId;
	if (/^-?\d+$/.test(instanceName)) {
		instanceId = parseInt(instanceName, 10);
	} else {
		let instances = await client.sendTo("controller", new libData.InstanceDetailsListRequest());
		for (let instance of instances) {
			if (instance.name === instanceName) {
				instanceId = instance.id;
				break;
			}
		}

		if (instanceId === undefined) {
			throw new libErrors.CommandError(`No instance named ${instanceName}`);
		}
	}

	return instanceId;
}

/**
 * Resolve a string to a mod pack ID
 *
 * Resolevs a string with either a mod pack name or an id into an integer
 * with the mod pack ID.
 *
 * @param {module:lib/link.Link} client -
 *     link to controller to query mod pack on.
 * @param {string} modPackName - string with name or id of mod pack.
 * @returns {Promise<number>} mod pack ID.
 * @static
 */
async function resolveModPack(client, modPackName) {
	let modPackId;
	if (/^-?\d+/.test(modPackName)) {
		modPackId = parseInt(modPackName, 10);
	} else {
		let modPacks = await client.sendTo("controller", new libData.ModPackListRequest());
		for (let modPack of modPacks) {
			if (modPack.name === modPackName) {
				modPackId = modPack.id;
				break;
			}
		}

		if (modPackId === undefined) {
			throw new libErrors.CommandError(`No mod pack named ${modPackName}`);
		}
	}

	return modPackId;
}

/**
 * Retrieve role object from string
 *
 * Resolves a string with either a role name or an id into an object
 * representing the role.
 *
 * @param {module:lib/link.Link} client - link to controller to query role on.
 * @param {string} roleName - string with name or id of role.
 * @returns {Promise<object>} Role info.
 * @static
 */
async function retrieveRole(client, roleName) {
	let roles = await client.sendTo("controller", new libData.RoleListRequest());

	let resolvedRole;
	if (/^-?\d+$/.test(roleName)) {
		let roleId = parseInt(roleName, 10);
		for (let role of roles) {
			if (role.id === roleId) {
				resolvedRole = role;
				break;
			}
		}

	} else {
		for (let role of roles) {
			if (role.name === roleName) {
				resolvedRole = role;
				break;
			}
		}
	}

	if (!resolvedRole) {
		throw new libErrors.CommandError(`No role named ${roleName}`);
	}

	return resolvedRole;
}

module.exports = {
	Command,
	CommandTree,

	resolveHost,
	resolveInstance,
	resolveModPack,
	retrieveRole,
};
