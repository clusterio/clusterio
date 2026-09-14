import fs from "node:fs/promises";

import { logger } from "./logging.js";
import { LockFile } from "./LockFile.js";
import type { Config, ConfigLocation } from "./config/classes.js";
import { StartupError } from "./errors.js";

export async function loadConfigFromArgs<T extends typeof Config<any>>(
	args: {
		config: string,
		bypassLockFile: boolean,
		createConfig: boolean,
		_: (string | number)[],
	},
	ConfigClass: T,
	location: ConfigLocation,
) {
	const configLockPath = `${args.config}.lock`;
	if (args.bypassLockFile) {
		await fs.unlink(configLockPath).catch(() => {}); // ignore error, file might not exist
	}

	const isCreateCommand = args._[0] === "config" && args._[1] === "create";
	const create = args.createConfig || isCreateCommand;

	let config;
	const configLock = new LockFile(configLockPath);
	const message = `${create ? "Creating" : "Loading"} config at ${args.config}`;
	if (location === "control") {
		// Ctl uses a verbose level here to avoid spamming the console.
		// A better idea would probably be to set Ctl's default level to warn.
		logger.verbose(message);
	} else {
		logger.info(message);
	}

	try {
		config = await ConfigClass.fromFile(location, args.config);

	} catch (err: any) {
		if (err.code !== "ENOENT" || !create) {
			throw new StartupError(`Failed to load ${args.config}: ${err.stack ?? err.message ?? err}`);
		}

		config = new ConfigClass(location, undefined, args.config);
		await config.save(true);
	}

	return [config as InstanceType<T>, configLock] as const;
}
