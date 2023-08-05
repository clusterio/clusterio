/**
 * Implementation of commands shared between controller/host/ctl.
 * @module lib/shared_commands
 */
"use strict";
import path from "path";

import * as libConfig from "./config";
import * as libFileOps from "./file_ops";
import { logger } from "./logging";
import * as libHelpers from "./helpers";


function print(...content: any[]) {
	// eslint-disable-next-line no-console
	console.log(...content);
}

/**
 * Yargs plugin command
 *
 * Can be passed to yargs.command to implement a plugin list management
 * command.  Use handlePluginCommand to do the requested action.
 *
 * @param yargs - yargs command builder.
 */
export function pluginCommand(yargs: any) {
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
 * @param args - yargs args object.
 * @param pluginList - Current list of plugins.
 * @param pluginListPath - Path to plugin list config file.
 */
export async function handlePluginCommand(
	args: Record<string, unknown>,
	pluginList: Map<string, string>,
	pluginListPath: string
) {
	let command = args._[1];

	if (command === "add") {
		let pluginPath = args.path as string;
		if (/^\.\.?[\/\\]/.test(pluginPath)) {
			pluginPath = path.resolve(pluginPath);
		}

		let pluginInfo: { name: string };
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
		await libFileOps.safeOutputFile(pluginListPath, JSON.stringify([...pluginList], null, 4));
		print(`Added ${pluginInfo.name}`);

	} else if (command === "remove") {
		if (!pluginList.delete(args.name as string)) {
			logger.error(`Plugin with name ${args.name} does not exist`);
			process.exitCode = 1;
			return;
		}

		await libFileOps.safeOutputFile(pluginListPath, JSON.stringify([...pluginList], null, 4));
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
 * @param yargs - yargs command builder.
 */
export function configCommand(yargs: any) {
	yargs
		.command("set <field> [value]", "Set config field", (yargs: any) => {
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
 * @param args - yargs args object.
 * @param instance - Config instance.
 * @param configPath - Path to configuration file.
 */
export async function handleConfigCommand(
	args: Record<string, unknown>,
	instance: libConfig.Config,
	configPath: string
) {
	let command = args._[1];

	if (command === "list") {
		for (let GroupClass of (instance as any).constructor.groups.values()) {
			for (let def of GroupClass.definitions.values()) {
				let value = instance.get(def.fullName);
				print(`${def.fullName} ${JSON.stringify(value)}`);
			}
		}

	} else if (command === "show") {
		try {
			print(instance.get(args.field as string));
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
			instance.set(args.field as string, args.value);
			await libFileOps.safeOutputFile(configPath, JSON.stringify(instance.serialize(), null, 4));
		} catch (err) {
			if (err instanceof libConfig.InvalidField || err instanceof libConfig.InvalidValue) {
				logger.error(err.message);
			} else {
				throw err;
			}
		}
	}
}
