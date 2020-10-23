/**
 * Implementation of commands shared between master/slave/ctl.
 * @module lib/shared_commands
 */
"use strict";
const fs = require("fs-extra");
const path = require("path");

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
			pluginInfo = require(path.posix.join(pluginPath, "info"));
		} catch (err) {
			console.error(`Unable to import plugin info from ${args.path}`);
			console.error(err);
			process.exitCode = 1;
			return;
		}

		if (pluginList.has(pluginInfo.name)) {
			console.error(`Plugin with the same ${pluginInfo.name} already exists`);
			process.exitCode = 1;
			return;
		}

		pluginList.set(pluginInfo.name, pluginPath);
		await fs.outputFile(pluginListPath, JSON.stringify([...pluginList], null, 4));
		console.log(`Added ${pluginInfo.name}`);

	} else if (command === "remove") {
		if (!pluginList.delete(args.name)) {
			console.error(`Plugin with name ${args.name} does not exist`);
			process.exitCode = 1;
			return;
		}

		await fs.outputFile(pluginListPath, JSON.stringify([...pluginList], null, 4));
		console.log(`Removed ${args.name}`);

	} else if (command === "list") {
		for (let [pluginName, pluginPath] of pluginList) {
			console.log(`${pluginName} - ${pluginPath}`);
		}
	}
}

module.exports = {
	pluginCommand,
	handlePluginCommand,
};
