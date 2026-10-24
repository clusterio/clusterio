import util from "util";
import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { logger } from "./logging.js";
import { RequestError } from "./errors.js";
import type { PluginNodeEnvInfo } from "./plugin.js";
import { isNonRegistryPackage } from "./load_plugin_list.js";
import { LockFile, LockFileExistsError } from "./LockFile.js";
import { checkRegistry, parsePackageSpec } from "./npm_registry.js";
const execAsync = util.promisify(exec);

function isDev() {
	//  dev:                 <devRoot>/packages/lib/dist/src/rce_ops.js
	// prod: <prodRoot>/node_modules/@clusterio/lib/dist/src/rce_ops.js
	return import.meta.dirname.split(path.sep).at(-5) === "packages"; // opposed to "@clusterio"
}

const operationInProgressMessage = "Another package operation is already in progress on this machine";
// A lock file without a valid pid is left alone for this long, as it may still be being written
const lockWriteGraceMs = 10e3;
// The start time tells this process apart from an earlier one with the same pid, and is shared by
// every copy of lib loaded in this process
const lockContent = `${process.pid} ${performance.timeOrigin}\n`;

type LockSnapshot = { content: string, ino: bigint, mtimeNs: bigint };

/** Content and identity of a lock file, read through one handle so both belong to the same file */
async function readLock(lockPath: string): Promise<LockSnapshot | undefined> {
	let handle;
	try {
		handle = await fs.open(lockPath, "r");
	} catch (err: any) {
		if (err.code === "ENOENT") {
			return undefined;
		}
		throw err;
	}
	try {
		const stat = await handle.stat({ bigint: true });
		return { content: await handle.readFile("utf8"), ino: stat.ino, mtimeNs: stat.mtimeNs };
	} finally {
		await handle.close();
	}
}

function isSameLock(a: LockSnapshot, b: LockSnapshot) {
	return a.content === b.content && a.ino === b.ino && a.mtimeNs === b.mtimeNs;
}

/** True if the lock names a process that is still running, or may still be written to */
async function lockIsLive(lock: LockSnapshot) {
	const pid = Number(lock.content.split(" ")[0]);
	if (!Number.isInteger(pid) || pid <= 0) {
		return Date.now() - Number(lock.mtimeNs / 1000000n) < lockWriteGraceMs;
	}
	if (pid === process.pid) {
		// Held by this process, or left by an earlier process with the same pid
		return lock.content === lockContent;
	}
	try {
		// Signal 0 only checks that the process exists
		process.kill(pid, 0);
		return true;
	} catch (err: any) {
		return err.code !== "ESRCH";
	}
}

/**
 * Remove a stale lock file if it is still the same file. Clearing is done while holding a separate
 * recovery lock, so a lock another process took after the stale check is never removed.
 */
async function removeStaleLock(lockPath: string, stale: LockSnapshot) {
	const recoveryPath = `${lockPath}.recovery`;
	try {
		await fs.writeFile(recoveryPath, lockContent, { flag: "wx" });
	} catch (err: any) {
		if (err.code !== "EEXIST") {
			throw err;
		}
		const holder = await readLock(recoveryPath);
		if (holder && !await lockIsLive(holder)) {
			throw new RequestError(
				`Package operation lock recovery was interrupted, remove ${recoveryPath} to allow package operations`
			);
		}
		return; // Another process is clearing it
	}
	try {
		const current = await readLock(lockPath);
		if (current && isSameLock(current, stale)) {
			await fs.unlink(lockPath);
		}
	} finally {
		await fs.unlink(recoveryPath).catch(() => {});
	}
}

/**
 * Lock file guarding npm operations in an installation. The content tells this process apart from
 * an earlier one with the same pid, and stale locks are cleared under a recovery lock.
 */
class NpmOperationLock extends LockFile {
	protected get content() {
		return lockContent;
	}

	async isStale() {
		const lock = await readLock(this.filePath);
		return lock === undefined || !await lockIsLive(lock);
	}

	/** Pid of the process holding the lock, if it has written it */
	async holder() {
		return (await readLock(this.filePath))?.content.split(" ")[0].trim() || undefined;
	}

	protected async removeStale() {
		const lock = await readLock(this.filePath);
		if (lock && !await lockIsLive(lock)) {
			await removeStaleLock(this.filePath, lock);
		}
	}

	protected async removeFile() {
		// Only remove the lock if it is still ours
		const existing = await fs.readFile(this.filePath, "utf8").catch(() => undefined);
		if (existing === lockContent) {
			await fs.unlink(this.filePath).catch(() => {});
		}
	}

	// Only the exit event is used, signal and uncaughtException listeners would change how the process exits.
	// If only this process is killed npm keeps running unlocked. Ctrl+C, systemd and containers stop it too.
	protected attachExitHandlers() {
		// eslint-disable-next-line node/no-sync
		process.on("exit", this.handleExitSync);
	}

	protected detachExitHandlers() {
		// eslint-disable-next-line node/no-sync
		process.off("exit", this.handleExitSync);
	}
}

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
		throw new RequestError(operationInProgressMessage);
	}
	operationInProgress = true;
	const lockPath = path.resolve("npm-operation.lock");
	const lock = new NpmOperationLock(lockPath);
	try {
		try {
			await lock.acquire();
		} catch (err) {
			if (!(err instanceof LockFileExistsError)) {
				throw err;
			}
			const holder = await lock.holder();
			throw new RequestError(
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
	return operationInProgress || !await new NpmOperationLock(path.resolve("npm-operation.lock")).isStale();
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
		throw new RequestError(`${name} is not installed from npm on this machine`);
	}
}

export async function handlePluginUpdate(pluginName: string, pluginInfos: PluginNodeEnvInfo[]) {
	// Optionally pinned to a version as name@version to update past the range in package.json
	const { name, version } = parsePackageSpec(pluginName);
	if (!pluginInfos.some(plugin => plugin.npmPackage === name)) {
		throw new RequestError(`Plugin ${name} is not installed on this machine`);
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
