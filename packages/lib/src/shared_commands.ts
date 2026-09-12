/**
 * Implementation of commands shared between controller/host/ctl.
 * @module lib/shared_commands
 */
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

import { loadPluginList } from "./load_plugin_list.js";
import * as libConfig from "./config/index.js";
import * as libFileOps from "./file_ops.js";
import { logger } from "./logging.js";
import * as libHelpers from "./helpers.js";
import { LockFile } from "./LockFile.js";
import { pathToFileURL } from "url";


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
		.command("install <package>", "Install plugin from npm and add it")
		.command("add <path>", "Add plugin by require path")
		.command("remove <name>", "Remove plugin by name")
		.command("list", "List all plugins and their path")
		.demandCommand(1, "You need to specify a command to run")
		.help()
		.strict()
	;
}

const corePackages = ["@clusterio/controller", "@clusterio/host", "@clusterio/ctl"];

/**
 * Check if the current directory is a Clusterio installation
 *
 * A directory counts as an installation if it has a package.json created
 * by the installer or one that depends on a Clusterio package.
 */
export async function isClusterioInstall(dir = process.cwd()) {
	let packageJson: { name?: string, dependencies?: Record<string, string> };
	try {
		packageJson = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
	} catch (err: any) {
		if (err.code === "ENOENT") {
			return false;
		}
		throw err;
	}
	if (packageJson.name === "clusterio-install") {
		return true;
	}
	return corePackages.some(name => packageJson.dependencies?.[name] !== undefined);
}

async function readDependencies(): Promise<Record<string, string>> {
	const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
	return packageJson.dependencies ?? {};
}

async function packageNameFromSpec(packageSpec: string) {
	try {
		const packageJson = JSON.parse(await fs.readFile(path.join(packageSpec, "package.json"), "utf8"));
		if (typeof packageJson.name === "string") {
			return packageJson.name;
		}
	} catch (err: any) {
		if (!["ENOENT", "ENOTDIR"].includes(err.code)) {
			throw err;
		}
	}
	return packageSpec.replace(/(?!^)@.*$/, "");
}

function npmInstall(packageSpec: string) {
	const npm = process.platform === "win32" ? "npm.cmd" : "npm";
	return new Promise<void>((resolve, reject) => {
		const child = spawn(npm, ["install", "--save", "--no-audit", "--no-fund", packageSpec], {
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		child.on("error", reject);
		child.on("exit", code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`npm install exited with code ${code}`));
			}
		});
	});
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
	let command = (args._ as string[])[1];
	const wrongDirHint = `${process.cwd()} is not a Clusterio installation, run this command from the directory ` +
		"Clusterio was installed in";

	if (command === "install") {
		if (!await isClusterioInstall()) {
			logger.error(wrongDirHint);
			process.exitCode = 1;
			return;
		}

		const packageSpec = args.package as string;
		const depsBefore = await readDependencies();
		try {
			await npmInstall(packageSpec);
		} catch (err: any) {
			logger.error(`Failed to install ${packageSpec}: ${err.message}`);
			process.exitCode = 1;
			return;
		}
		const depsAfter = await readDependencies();

		const newPluginList = await loadPluginList(pluginListPath);
		const added = [...newPluginList.keys()].filter(name => !pluginList.has(name));
		for (const name of added) {
			pluginList.set(name, newPluginList.get(name)!);
			print(`Installed ${name}`);
		}
		if (added.length) {
			return;
		}

		// Nothing new, either the plugin was already in the list or the package is not a plugin.
		let packageNames = Object.keys(depsAfter).filter(name => depsAfter[name] !== depsBefore[name]);
		if (!packageNames.length) {
			packageNames = [await packageNameFromSpec(packageSpec)];
		}
		const existing = [...pluginList].filter(([, requirePath]) => packageNames.includes(requirePath));
		if (existing.length) {
			for (const [name] of existing) {
				print(`${name} is already installed`);
			}
		} else {
			logger.error(`${packageSpec} was installed but did not provide any plugins`);
			process.exitCode = 1;
		}

	} else if (command === "add") {
		let pluginPath = args.path as string;
		if (/^\.\.?[\/\\]/.test(pluginPath)) {
			pluginPath = path.resolve(pluginPath);
		} else if (!path.isAbsolute(pluginPath) && !await isClusterioInstall()) {
			logger.warn(wrongDirHint);
		}

		let pluginInfo: { name: string };
		try {
			const pluginPackage = (await import(
				pathToFileURL(path.posix.join(pluginPath, "package.json")).href,
				{ with: { type: "json" }},
			)).default;
			pluginInfo = (await import(
				pathToFileURL(path.posix.join(pluginPath, pluginPackage.main ?? "index.js")).href
			)).plugin;
		} catch (err: any) {
			logger.error(`Unable to import plugin info from ${args.path}:\n${err.stack}`);
			process.exitCode = 1;
			return;
		}

		if (typeof pluginInfo !== "object") {
			logger.error("Plugin does not correctly export a 'plugin' object");
			process.exitCode = 1;
			return;
		}

		if (pluginList.has(pluginInfo.name)) {
			logger.error(`Plugin with the same ${pluginInfo.name} already exists`);
			process.exitCode = 1;
			return;
		}

		pluginList.set(pluginInfo.name, pluginPath);
		await libFileOps.safeOutputFile(pluginListPath, JSON.stringify([...pluginList], null, "\t"));
		print(`Added ${pluginInfo.name}`);

	} else if (command === "remove") {
		if (!pluginList.delete(args.name as string)) {
			logger.error(`Plugin with name ${args.name} does not exist`);
			process.exitCode = 1;
			return;
		}

		await libFileOps.safeOutputFile(pluginListPath, JSON.stringify([...pluginList], null, "\t"));
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
 * @param lockFile - Lockfile required if attempting to write
 */
export async function handleConfigCommand(
	args: Record<string, unknown>,
	instance: libConfig.Config<any>,
	lockFile: LockFile,
) {
	let command = (args._ as string[])[1];

	if (command === "list") {
		for (const name of Object.keys(instance.constructor.fieldDefinitions)) {
			print(`${name} ${JSON.stringify(instance.get(name))}`);
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
		await lockFile.acquire();

		if (args.stdin) {
			args.value = (await libHelpers.readStream(process.stdin)).toString().replace(/\r?\n$/, "");

		} else if (args.value === undefined) {
			args.value = null;
		}

		try {
			instance.set(args.field as string, args.value);
			await instance.save();
		} catch (err) {
			if (err instanceof libConfig.InvalidField || err instanceof libConfig.InvalidValue) {
				logger.error(err.message);
			} else {
				throw err;
			}
		}

		await lockFile.release();
	}
}
