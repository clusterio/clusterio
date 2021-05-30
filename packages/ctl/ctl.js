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
const events = require("events");
const path = require("path");
const winston = require("winston");
const setBlocking = require("set-blocking");
const phin = require("phin");

const libLink = require("@clusterio/lib/link");
const libErrors = require("@clusterio/lib/errors");
const libConfig = require("@clusterio/lib/config");
const libPlugin = require("@clusterio/lib/plugin");
const libPluginLoader = require("@clusterio/lib/plugin_loader");
const libCommand = require("@clusterio/lib/command");
const libSharedCommands = require("@clusterio/lib/shared_commands");
const { ConsoleTransport, levels, logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");
const libHelpers = require("@clusterio/lib/helpers");
const libFactorio = require("@clusterio/lib/factorio");


function print(...content) {
	// eslint-disable-next-line no-console
	console.log(...content);
}


const masterCommands = new libCommand.CommandTree({ name: "master", description: "Master management" });
const masterConfigCommands = new libCommand.CommandTree({
	name: "config", alias: ["c"], description: "master config management",
});
masterConfigCommands.add(new libCommand.Command({
	definition: ["list", "List master configuration"],
	handler: async function(args, control) {
		let response = await libLink.messages.getMasterConfig.send(control);

		for (let group of response.serialized_config.groups) {
			for (let [name, value] of Object.entries(group.fields)) {
				print(`${group.name}.${name} ${JSON.stringify(value)}`);
			}
		}
	},
}));

masterConfigCommands.add(new libCommand.Command({
	definition: ["set <field> [value]", "Set field in master config", (yargs) => {
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("value", { describe: "Value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args, control) {
		if (args.stdin) {
			args.value = (await libHelpers.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		} else if (args.value === undefined) {
			args.value = "";
		}
		await libLink.messages.setMasterConfigField.send(control, {
			field: args.field,
			value: args.value,
		});
	},
}));

masterConfigCommands.add(new libCommand.Command({
	definition: ["set-prop <field> <prop> [value]", "Set property of field in master config", (yargs) => {
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("prop", { describe: "Property to set", type: "string" });
		yargs.positional("value", { describe: "JSON parsed value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args, control) {
		if (args.stdin) {
			args.value = (await libHelpers.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		}
		let request = {
			field: args.field,
			prop: args.prop,
		};
		try {
			if (args.value !== undefined) {
				request.value = JSON.parse(args.value);
			}
		} catch (err) {
			// See note for the instance version of set-prop
			if (args.stdin || /^(\[.*]|{.*}|".*")$/.test(args.value)) {
				throw new libErrors.CommandError(`In parsing value '${args.value}': ${err.message}`);
			}
			request.value = args.value;
		}
		await libLink.messages.setMasterConfigProp.send(control, request);
	},
}));
masterCommands.add(masterConfigCommands);


const masterPluginCommands = new libCommand.CommandTree({
	name: "plugin", alias: ["p"], description: "master plugin inspection",
});
masterPluginCommands.add(new libCommand.Command({
	definition: ["list", "List plugins on master"],
	handler: async function(args, control) {
		let url = new URL(control.config.get("control.master_url"));
		url.pathname += "api/plugins";
		let response = await phin({
			url,
			parse: "json",
			core: { ca: control.tlsCa },
		});
		print(asTable(response.body));
	},
}));
masterCommands.add(masterPluginCommands);


const slaveCommands = new libCommand.CommandTree({ name: "slave", description: "Slave management" });
slaveCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List slaves connected to the master"],
	handler: async function(args, control) {
		let response = await libLink.messages.listSlaves.send(control);
		print(asTable(response.list));
	},
}));

slaveCommands.add(new libCommand.Command({
	definition: ["generate-token", "Generate token for a slave", (yargs) => {
		yargs.option("id", { type: "number", nargs: 1, describe: "Slave id", demandOption: true });
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.generateSlaveToken.send(control, { slave_id: args.id });
		print(response.token);
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
			print(content);
		} else {
			logger.info(`Writing ${args.output}`);
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
		print(asTable(response.list));
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
		let instanceConfig = new libConfig.InstanceConfig("control");
		await instanceConfig.init();
		if (args.id) {
			instanceConfig.set("instance.id", args.id);
		}
		instanceConfig.set("instance.name", args.name);
		let serialized_config = instanceConfig.serialize("master");
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
				print(`${group.name}.${name} ${JSON.stringify(value)}`);
			}
		}
	},
}));

instanceConfigCommands.add(new libCommand.Command({
	definition: ["set <instance> <field> [value]", "Set field in instance config", (yargs) => {
		yargs.positional("instance", { describe: "Instance to set config on", type: "string" });
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("value", { describe: "Value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		if (args.stdin) {
			args.value = (await libHelpers.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		} else if (args.value === undefined) {
			args.value = "";
		}
		await libLink.messages.setInstanceConfigField.send(control, {
			instance_id: instanceId,
			field: args.field,
			value: args.value,
		});
	},
}));

instanceConfigCommands.add(new libCommand.Command({
	definition: ["set-prop <instance> <field> <prop> [value]", "Set property of field in instance config", (yargs) => {
		yargs.positional("instance", { describe: "Instance to set config on", type: "string" });
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("prop", { describe: "Property to set", type: "string" });
		yargs.positional("value", { describe: "JSON parsed value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		if (args.stdin) {
			args.value = (await libHelpers.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		}
		let request = {
			instance_id: instanceId,
			field: args.field,
			prop: args.prop,
		};
		try {
			if (args.value !== undefined) {
				request.value = JSON.parse(args.value);
			}
		} catch (err) {
			// If this is from stdin or looks like an array, object or string
			// literal throw the parse error, otherwise assume this is a string.
			// The resoning behind this is that correctly quoting the string
			// with the all the layers of quote removal at play is difficult.
			// See the following table for how to pass "That's a \" quote" in
			// different environments:
			// cmd              : """""That's a \\"" quote"""""
			// cmd + npx        : """""""""""That's a \\\\"""" quote"""""""""""
			// PowerShell       : '"""""That''s a \\"" quote"""""'
			// PowerShell + npx : '"""""""""""That''s a \\\\"""" quote"""""""""""'
			// bash             : '""That'\''s a \" quote""'
			// bash + npx       : '""That'\''s a \" quote""'
			// bash + npx -s sh : "'\"\"That'\\''s a \\\" quote\"\"'"
			if (args.stdin || /^(\[.*]|{.*}|".*")$/.test(args.value)) {
				throw new libErrors.CommandError(`In parsing value '${args.value}': ${err.message}`);
			}
			request.value = args.value;
		}
		await libLink.messages.setInstanceConfigProp.send(control, request);
	},
}));
instanceCommands.add(instanceConfigCommands);

instanceCommands.add(new libCommand.Command({
	definition: ["assign <instance> [slave]", "Assign instance to a slave", (yargs) => {
		yargs.positional("instance", { describe: "Instance to assign", type: "string" });
		yargs.positional("slave", { describe: "Slave to assign to or unassign if none", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let slaveId = args.slave ? await libCommand.resolveSlave(control, args.slave) : null;
		await libLink.messages.assignInstanceCommand.send(control, {
			instance_id: instanceId,
			slave_id: slaveId,
		});
	},
}));

async function loadMapSettings(args) {
	let seed = args.seed !== undefined ? args.seed : null;
	let mapGenSettings = null;
	let mapSettings = null;
	if (args.mapExchangeString) {
		let parsed = libFactorio.readMapExchangeString(args.mapExchangeString);
		mapGenSettings = parsed.map_gen_settings;
		mapSettings = parsed.map_settings;
	}
	if (args.mapGenSettings) {
		mapGenSettings = JSON.parse(await fs.readFile(args.mapGenSettings));
	}
	if (args.mapSettings) {
		mapSettings = JSON.parse(await fs.readFile(args.mapSettings));
	}

	return {
		seed,
		mapGenSettings,
		mapSettings,
	};
}

instanceCommands.add(new libCommand.Command({
	definition: ["list-saves <instance>", "list saves on an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to list saves on", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let response = await libLink.messages.listSaves.send(control, { instance_id: instanceId });
		for (let entry of response.list) {
			entry.mtime = new Date(entry.mtime_ms).toLocaleString();
			delete entry.mtime_ms;
		}
		print(asTable(response.list));
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["create-save <instance> [name]", "Create a new save on an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to create on", type: "string" });
		yargs.positional("name", { describe: "Name of save to create.", type: "string", default: "world.zip" });
		yargs.options({
			"seed": { describe: "Seed to use, takes precedence over map-gen-settings", nargs: 1, type: "number" },
			"map-exchange-string": { describe: "Map exchange string to use for the save", nargs: 1, type: "string" },
			"map-gen-settings": { describe: "path to file to use for map-gen-settings", nargs: 1, type: "string" },
			"map-settings": { describe: "path to file to use for map-settings", nargs: 1, type: "string" },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let { seed, mapGenSettings, mapSettings } = await loadMapSettings(args);
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
		let response = await libLink.messages.createSave.send(control, {
			instance_id: instanceId,
			name: args.name,
			seed,
			map_gen_settings: mapGenSettings,
			map_settings: mapSettings,
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["upload-save <instance> <filepath>", "Upload a save to an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to upload to", type: "string" });
		yargs.positional("filepath", { describe: "Path to save to upload", type: "string" });
		yargs.options({
			"name": { describe: "Name to give save on server", nargs: 1, type: "string" },
		});
	}],
	handler: async function(args, control) {
		let filename = args.name || path.basename(args.filepath);
		if (!filename.endsWith(".zip")) {
			throw new libErrors.CommandError("Save name must end with .zip");
		}
		// phin doesn't support streaming requests :(
		let content = await fs.readFile(args.filepath);

		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let url = new URL(control.config.get("control.master_url"));
		url.pathname += "api/upload-save";
		url.searchParams.append("instance_id", instanceId);
		url.searchParams.append("filename", filename);

		let result = await phin({
			url, method: "POST",
			headers: {
				"X-Access-Token": control.config.get("control.master_token"),
				"Content-Type": "application/zip",
			},
			core: { ca: control.tlsCa },
			data: content,
			parse: "json",
		});

		for (let error of result.body.errors || []) {
			logger.error(error);
		}

		for (let requestError of result.body.request_errors || []) {
			logger.error(error);
		}

		if (result.body.saves && result.body.saves.length) {
			logger.info(`Successfully uploaded as ${result.body.saves[0]}`);
		}

		if ((result.body.errors || []).length || (result.body.request_errors || []).length) {
			throw new libErrors.CommandError("Uploading save failed");
		}
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["export-data <instance>", "Export item icons and locale from instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to export from", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
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
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
		let response = await libLink.messages.startInstance.send(control, {
			instance_id: instanceId,
			save: args.save || null,
		});
		control.keepOpen = args.keepOpen;
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["load-scenario <instance> <scenario>", "Start instance by loading a scenario", (yargs) => {
		yargs.positional("instance", { describe: "Instance to start", type: "string" });
		yargs.positional("scenario", { describe: "Scenario to load", type: "string" });
		yargs.options({
			"seed": { describe: "Seed to use, takes precedence over map-gen-settings", nargs: 1, type: "number" },
			"map-exchange-string": { describe: "Map exchange string to use for the save", nargs: 1, type: "string" },
			"map-gen-settings": { describe: "path to file to use for map-gen-settings", nargs: 1, type: "string" },
			"map-settings": { describe: "path to file to use for map-settings", nargs: 1, type: "string" },
			"keep-open": { describe: "Keep console open", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
		let { seed, mapGenSettings, mapSettings } = await loadMapSettings(args);
		let response = await libLink.messages.loadScenario.send(control, {
			instance_id: instanceId,
			scenario: args.scenario,
			seed,
			map_gen_settings: mapGenSettings,
			map_settings: mapSettings,
		});
		control.keepOpen = args.keepOpen;
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["stop <instance>", "Stop instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to stop", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
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
		print(asTable(response.list));
	},
}));


const roleCommands = new libCommand.CommandTree({ name: "role", description: "Role management" });
roleCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List roles in the cluster"],
	handler: async function(args, control) {
		let response = await libLink.messages.listRoles.send(control);
		print(asTable(response.list));
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
		logger.info(`Created role ID ${response.id}`);
	},
}));

roleCommands.add(new libCommand.Command({
	definition: ["edit <role>", "Edit existing role", (yargs) => {
		yargs.positional("role", { describe: "Role to edit", type: "string" });
		yargs.options({
			"name": { describe: "New name for role", nargs: 1, type: "string" },
			"description": { describe: "New description for role", nargs: 1, type: "string" },
			"set-perms": { describe: "Set permissions for role", array: true, type: "string" },
			"add-perms": { describe: "Add permissions to role", array: true, type: "string", conflicts: "set-perms" },
			"remove-perms": {
				describe: "Remove permissions from role", array: true, type: "string", conflicts: "set-perms",
			},
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
		if (args.addPerms) {
			role.permissions = role.permissions.concat(args.addPerms);
		}
		if (args.removePerms) {
			let perms = new Set(role.permissions);
			for (let perm of args.removePerms) {
				perms.delete(perm);
			}
			role.permissions = [...perms];
		}
		if (args.setPerms !== undefined) {
			role.permissions = args.setPerms;
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
		print(asTable(response.list));
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

const logCommands = new libCommand.CommandTree({ name: "log", description: "Log inspection" });
logCommands.add(new libCommand.Command({
	definition: ["follow", "follow cluster log", (yargs) => {
		yargs.options({
			"all": { describe: "Follow the whole cluster log", nargs: 0, type: "boolean", default: false },
			"master": { describe: "Follow log of the master server", nargs: 0, type: "boolean", default: false },
			"slave": { describe: "Follow log of given slave", nargs: 1, type: "string", default: null },
			"instance": { describe: "Follow log of given instance", nargs: 1, type: "string", default: null },
		});
	}],
	handler: async function(args, control) {
		if (!args.all && !args.master && !args.slave && !args.instance) {
			logger.error("At least one of --all, --master, --slave and --instance must be passed");
			process.exitCode = 1;
			return;
		}
		let instance_ids = args.instance ? [await libCommand.resolveInstance(control, args.instance)] : [];
		let slave_ids = args.slave ? [await libCommand.resolveSlave(control, args.slave)] : [];
		await control.setLogSubscriptions({ all: args.all, master: args.master, slave_ids, instance_ids });
		control.keepOpen = true;
	},
}));

logCommands.add(new libCommand.Command({
	definition: ["query", "Query cluster log", (yargs) => {
		yargs.options({
			"all": { describe: "Query the whole cluster log", nargs: 0, type: "boolean", default: false },
			"master": { describe: "Query log of the master server", nargs: 0, type: "boolean", default: false },
			"slave": { describe: "Query log of given slave", nargs: 1, type: "string", default: null },
			"instance": { describe: "Query log of given instance", nargs: 1, type: "string", default: null },
			"max-level": { describe: "Maximum log level to return", nargs: 1, type: "string", default: null },
		});
	}],
	handler: async function(args, control) {
		if (!args.all && !args.master && !args.slave && !args.instance) {
			logger.error("At least one of --all, --master, --slave and --instance must be passed");
			process.exitCode = 1;
			return;
		}
		let instance_ids = args.instance ? [await libCommand.resolveInstance(control, args.instance)] : [];
		let slave_ids = args.slave ? [await libCommand.resolveSlave(control, args.slave)] : [];
		let result = await libLink.messages.queryLog.send(control, {
			all: args.all,
			master: args.master,
			slave_ids,
			instance_ids,
			max_level: args.maxLevel,
		});

		let stdoutLogger = winston.createLogger({
			level: "verbose",
			levels,
			format: new libLoggingUtils.TerminalFormat({ showTimestamp: true }),
			transports: [
				new ConsoleTransport({ errorLevels: [], warnLevels: [] }),
			],
		});
		for (let info of result.log) {
			stdoutLogger.log(info);
		}
	},
}));

const debugCommands = new libCommand.CommandTree({ name: "debug", description: "Debugging utilities" });
debugCommands.add(new libCommand.Command({
	definition: ["dump-ws", "Dump WebSocket messages sent and received by master", (yargs) => { }],
	handler: async function(args, control) {
		await libLink.messages.debugDumpWs.send(control);
		control.keepOpen = true;
	},
}));


/**
 * Connector for control connection to master server
 * @private
 */
class ControlConnector extends libLink.WebSocketClientConnector {
	constructor(url, reconnectDelay, tlsCa, token) {
		super(url, reconnectDelay, tlsCa);
		this._token = token;
	}

	register() {
		logger.verbose("SOCKET | registering control");
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

	constructor(connector, controlConfig, tlsCa, controlPlugins) {
		super("control", "master", connector);
		libLink.attachAllMessages(this);

		/**
		 * Control config used for connecting to the master.
		 * @type {module:lib/config.ControlConfig}
		 */
		this.config = controlConfig;
		/**
		 * Certificate authority used to validate TLS connections to the master.
		 * @type {?string}
		 */
		this.tlsCa = tlsCa;
		/**
		 * Mapping of plugin names to their instance for loaded plugins.
		 * @type {Map<string, module:lib/plugin.BaseControlPlugin>}
		 */
		this.plugins = controlPlugins;
		for (let controlPlugin of controlPlugins.values()) {
			libPlugin.attachPluginMessages(this, controlPlugin);
		}

		/**
		 * Keep the control connection alive after the command completes.
		 * @type {boolean}
		 */
		this.keepOpen = false;
	}

	async instanceUpdateEventHandler() { }

	async saveListUpdateEventHandler() { }

	async setLogSubscriptions({
		all = false,
		master = false,
		slave_ids = [],
		instance_ids = [],
		max_level = null,
	}) {
		await libLink.messages.setLogSubscriptions.send(this, {
			all, master, slave_ids, instance_ids, max_level,
		});
	}

	async logMessageEventHandler(message) {
		logger.log(message.data.info);
	}

	async debugWsMessageEventHandler(message) {
		print("WS", message.data.direction, message.data.content);
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

async function loadPlugins(pluginList) {
	let pluginInfos = await libPluginLoader.loadPluginInfos(pluginList);
	libConfig.registerPluginConfigGroups(pluginInfos);
	libConfig.finalizeConfigs();

	let controlPlugins = new Map();
	for (let pluginInfo of pluginInfos) {
		if (!pluginInfo.controlEntrypoint) {
			continue;
		}

		let ControlPluginClass = await libPluginLoader.loadControlPluginClass(pluginInfo);
		let controlPlugin = new ControlPluginClass(pluginInfo, logger);
		controlPlugins.set(pluginInfo.name, controlPlugin);
		await controlPlugin.init();
	}
	return controlPlugins;
}

async function registerCommands(controlPlugins, yargs) {
	const rootCommands = new libCommand.CommandTree({ name: "clusterioctl", description: "Manage cluster" });
	rootCommands.add(masterCommands);
	rootCommands.add(slaveCommands);
	rootCommands.add(instanceCommands);
	rootCommands.add(permissionCommands);
	rootCommands.add(roleCommands);
	rootCommands.add(userCommands);
	rootCommands.add(logCommands);
	rootCommands.add(debugCommands);

	for (let controlPlugin of controlPlugins.values()) {
		await controlPlugin.addCommands(rootCommands);
	}

	for (let [name, command] of rootCommands.subCommands) {
		if (name === command.name) {
			command.register(yargs);
		}
	}

	return rootCommands;
}

async function startControl() {
	yargs
		.scriptName("clusterioctl")
		.usage("$0 <command> [options]")
		.option("log-level", {
			nargs: 1,
			describe: "Log level to print to stderr",
			default: "server",
			choices: Object.keys(levels),
			type: "string",
		})
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
	let args = yargs.parse();

	// Log stream for the ctl session.
	logger.add(new ConsoleTransport({
		errorLevels: Object.keys(levels),
		level: args.logLevel,
		format: new libLoggingUtils.TerminalFormat(),
	}));

	logger.verbose(`Loading available plugins from ${args.pluginList}`);
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

	logger.verbose("Loading Plugins");
	let controlPlugins = await loadPlugins(pluginList);

	// Add all cluster management commands including ones from plugins
	let rootCommands = await registerCommands(controlPlugins, yargs);

	// Reparse after commands have been added with help and strict checking.
	args = yargs
		.help()
		.strict()
		.parse()
	;

	logger.verbose(`Loading config from ${args.config}`);
	let controlConfig = new libConfig.ControlConfig("control");
	try {
		await controlConfig.load(JSON.parse(await fs.readFile(args.config)));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.verbose("Config not found, initializing new config");
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
		logger.error("Missing URL and/or token to connect with.  See README.md for setting up access.");
		process.exitCode = 1;
		return;
	}

	let tlsCa = null;
	let tlsCaPath = controlConfig.get("control.tls_ca");
	if (tlsCaPath) {
		tlsCa = await fs.readFile(tlsCaPath);
	}

	let controlConnector = new ControlConnector(
		controlConfig.get("control.master_url"),
		controlConfig.get("control.reconnect_delay"),
		tlsCa,
		controlConfig.get("control.master_token")
	);
	let control = new Control(controlConnector, controlConfig, tlsCa, controlPlugins);
	try {
		await controlConnector.connect();
	} catch (err) {
		if (err instanceof libErrors.AuthenticationFailed) {
			throw new libErrors.StartupError(err.message);
		}
		throw err;
	}

	process.on("SIGINT", () => {
		logger.info("Caught interrupt signal, closing connection");
		control.shutdown().catch(err => {
			setBlocking(true);
			logger.error(err.stack);
			// eslint-disable-next-line node/no-process-exit
			process.exit(1);
		});
	});

	try {
		await targetCommand.run(args, control);

	} catch (err) {
		control.keepOpen = false;
		if (err instanceof libErrors.CommandError) {
			logger.error(`Error running command: ${err.message}`);
			process.exitCode = 1;

		} else if (err instanceof libErrors.RequestError) {
			logger.error(`Error sending request: ${err.message}`);
			process.exitCode = 1;

		} else {
			throw err;
		}

	} finally {
		if (!control.keepOpen) {
			await control.shutdown();
		}
	}
}

module.exports = {
	Control,
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
	startControl().catch(err => {
		if (!(err instanceof libErrors.StartupError)) {
			logger.fatal(`
+----------------------------------------------------------------+
| Unexpected error occured while starting control, please report |
| it to https://github.com/clusterio/factorioClusterio/issues    |
+----------------------------------------------------------------+
${err.stack}`
			);
		} else {
			logger.error(`
+---------------------------------+
| Unable to to start clusterioctl |
+---------------------------------+
${err.stack}`
			);
		}

		process.exitCode = 1;
	});
}
