/**
 * Implementation of commands shared between master/slave/ctl.
 * @module lib/shared_commands
 */
"use strict";
const fs = require("fs-extra");
const path = require("path");

const libConfig = require("./config");
const { logger } = require("./logging");
const libHelpers = require("./helpers");


function print(...content) {
	// eslint-disable-next-line no-console
	console.log(...content);
}

/**
 * Yargs plugin command
 *
 * Can be passed to yargs.command to implement a plugin list management
 * command.  Use handlePluginCommand to do the requested action.
 *
 * @param {Object} yargs - yargs command builder.
 */
function pluginCommand(yargs) {
	yargs
		.command("add <path>", "Add plugin by require path")
		.command("remove <name>", "Remove plugin by name")
		.command("list", "List all plugins and their path")
		.demandCommand(1, "You need to specify a command to run")
		.help()
		.strict()
	;
}

/**
 * Handle yargs plugin command
 *
 * Handle the actions that are made available by pluginCommand.
 *
 * @param {Object} args - yargs args object.
 * @param {Map<string, string>} pluginList - Current list of plugins.
 * @param {string} pluginListPath - Path to plugin list config file.
 */
async function handlePluginCommand(args, pluginList, pluginListPath) {
	let command = args._[1];

	if (command === "add") {
		let pluginPath = args.path;
		if (/^\.\.?[\/\\]/.test(pluginPath)) {
			pluginPath = path.resolve(pluginPath);
		}

		let pluginInfo;
		try {
			// eslint-disable-next-line node/global-require
			pluginInfo = require(path.posix.join(pluginPath, "info"));
		} catch (err) {
			logger.error(`Unable to import plugin info from ${args.path}:\n${err.stack}`);
			process.exitCode = 1;
			return;
		}

		if (pluginList.has(pluginInfo.name)) {
			logger.error(`Plugin with the same ${pluginInfo.name} already exists`);
			process.exitCode = 1;
			return;
		}

		pluginList.set(pluginInfo.name, pluginPath);
		await fs.outputFile(pluginListPath, JSON.stringify([...pluginList], null, 4));
		print(`Added ${pluginInfo.name}`);

	} else if (command === "remove") {
		if (!pluginList.delete(args.name)) {
			logger.error(`Plugin with name ${args.name} does not exist`);
			process.exitCode = 1;
			return;
		}

		await fs.outputFile(pluginListPath, JSON.stringify([...pluginList], null, 4));
		print(`Removed ${args.name}`);

	} else if (command === "list") {
		for (let [pluginName, pluginPath] of pluginList) {
			print(`${pluginName} - ${pluginPath}`);
		}
	}
}


/**
 * Yargs config command
 *
 * Can be passed to yargs.command to implement a config command.  Use
 * handleConfigCommand to do the requested action.
 *
 * @param {Object} yargs - yargs command builder.
 */
function configCommand(yargs) {
	yargs
		.command("set <field> [value]", "Set config field", yargs => {
			yargs.options({
				"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
			});
		})
		.command("show <field>", "Show value of the given config field")
		.command("list", "List all configuration fields and their values")
		.demandCommand(1, "You need to specify a command to run")
		.help()
		.strict()
	;
}

/**
 * Handle yargs command
 *
 * Handle the actions that are made available by configCommand.
 *
 * @param {Object} args - yargs args object.
 * @param {module:lib/config.Config} instance - Config instance.
 * @param {string} configPath - Path to configuration file.
 */
async function handleConfigCommand(args, instance, configPath) {
	let command = args._[1];

	if (command === "list") {
		for (let GroupClass of instance.constructor.groups.values()) {
			for (let def of GroupClass.definitions.values()) {
				let value = instance.get(def.fullName);
				print(`${def.fullName} ${JSON.stringify(value)}`);
			}
		}

	} else if (command === "show") {
		try {
			print(instance.get(args.field));
		} catch (err) {
			if (err instanceof libConfig.InvalidField) {
				logger.error(err.message);
			} else {
				throw err;
			}
		}

	} else if (command === "set") {
		if (args.stdin) {
			args.value = (await libHelpers.readStream(process.stdin)).toString().replace(/\r?\n$/, "");

		} else if (args.value === undefined) {
			args.value = null;
		}

		try {
			instance.set(args.field, args.value);
			await fs.outputFile(configPath, JSON.stringify(instance.serialize(), null, 4));
		} catch (err) {
			if (err instanceof libConfig.InvalidField || err instanceof libConfig.InvalidValue) {
				logger.error(err.message);
			} else {
				throw err;
			}
		}
	}
}


module.exports = {
	pluginCommand,
	handlePluginCommand,

	configCommand,
	handleConfigCommand,
};
