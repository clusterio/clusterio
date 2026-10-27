import util from "util";
import path from "path";
import { exec } from "child_process";
import { logger } from "./logging.js";
import { ConflictError, NotFoundError, UnavailableError } from "./errors.js";
import type { PluginNodeEnvInfo } from "./plugin.js";
import { isNonRegistryPackage } from "./load_plugin_list.js";
import { LockFile, LockFileExistsError, LockFileRecoveryError } from "./LockFile.js";
import { checkRegistry, parsePackageSpec } from "./npm_registry.js";
const execAsync = util.promisify(exec);

function isDev() {
	//  dev:                 <devRoot>/packages/lib/dist/src/rce_ops.js
	// prod: <prodRoot>/node_modules/@clusterio/lib/dist/src/rce_ops.js
	return import.meta.dirname.split(path.sep).at(-5) === "packages"; // opposed to "@clusterio"
}

const operationInProgressMessage = "Another package operation is already in progress on this machine";

let operationInProgress = false;

/**
 * Run an npm command, at most one at a time per installation. npm runs in the working directory,
 * which a standalone controller and host share, so a lock file there guards against operations
 * from other processes and other copies of lib. The flag makes concurrent calls through this copy
 * reject without racing a release of the lock.
 *
 * @param cmd - Command to run
 * @param check - Called while holding the lock before running the command, may throw to cancel it
 */
async function logExec(cmd: string, check?: () => Promise<void>) {
	// Checked and set before the first await so concurrent calls in this process can't interleave
	if (operationInProgress) {
		throw new ConflictError(operationInProgressMessage);
	}
	operationInProgress = true;
	const lockPath = path.resolve("npm-operation.lock");
	// Signal listeners would change how the process exits. If only this process is killed npm keeps
	// running unlocked, Ctrl+C, systemd and containers stop it too.
	const lock = new LockFile(lockPath, false);
	try {
		try {
			await lock.acquire();
		} catch (err) {
			if (err instanceof LockFileRecoveryError) {
				throw new UnavailableError(err.message);
			}
			if (!(err instanceof LockFileExistsError)) {
				throw err;
			}
			const holder = await lock.holderPid();
			throw new ConflictError(
				`${operationInProgressMessage}${holder ? ` (${lockPath} is held by process ${holder})` : ""}`
			);
		}
		try {
			await check?.();
			logger.audit(`RCE | ${cmd}`);
			if (!isDev()) {
				await execAsync(cmd);
			}
		} finally {
			await lock.release();
		}
	} finally {
		operationInProgress = false;
	}
}

export async function updatePackage(...names: string[]) {
	return logExec(`npm update --save ${names.join(" ")}`);
}

export async function installPackage(name: string, check?: () => Promise<void>) {
	return logExec(`npm install --save ${name}`, check);
}

/** Whether an npm operation is running in this installation, from this or another process */
export async function packageOperationRunning() {
	return operationInProgress || !await new LockFile(path.resolve("npm-operation.lock")).isStale();
}

export async function handleUpdateAll(corePackage: string, pluginInfos: PluginNodeEnvInfo[]) {
	const pluginPackages = pluginInfos
		.map(plugin => plugin.npmPackage)
		.filter((name): name is string => name !== undefined);
	return await updatePackage(corePackage, ...pluginPackages);
}

/** Throws if the dependency by this name is a path, git, url or alias that installing by name would replace */
async function checkNotLocalDependency(name: string) {
	if (await isNonRegistryPackage(name)) {
		throw new ConflictError(`${name} is not installed from npm on this machine`);
	}
}

export async function handlePluginUpdate(pluginName: string, pluginInfos: PluginNodeEnvInfo[]) {
	// Optionally pinned to a version as name@version to update past the range in package.json
	const { name, version } = parsePackageSpec(pluginName);
	if (!pluginInfos.some(plugin => plugin.npmPackage === name)) {
		throw new NotFoundError(`Plugin ${name} is not installed on this machine`);
	}

	if (version === undefined) {
		return await updatePackage(name);
	}
	// Checked under the lock as another operation may change where it's installed from
	return await installPackage(await checkRegistry(name, version), () => checkNotLocalDependency(name));
}

/** Install a plugin, optionally pinned to a version as name@version, returns the package name */
export async function handlePluginInstall(pluginName: string) {
	const { name, version } = parsePackageSpec(pluginName);
	await installPackage(await checkRegistry(name, version), () => checkNotLocalDependency(name));
	return name;
}
