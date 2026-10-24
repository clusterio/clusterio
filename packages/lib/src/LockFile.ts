import fs, { type FileHandle } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import assert from "assert";

// A lock file without a valid pid is left alone for this long, as it may still be being written
const lockWriteGraceMs = 10e3;

/**
 * Error thrown when the lock file already exists.
 */
export class LockFileExistsError extends Error {
	constructor(
		readonly filePath: string
	) {
		super(`Cannot acquire lock, a valid lock file exists at ${filePath}`);
		this.name = "LockFileExistsError";
	}
}

/**
 * Error thrown when the acquire or release called during an invalid state.
 */
export class LockFileBusyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LockFileBusyError";
	}
}

/**
 * Error thrown when a process exited while clearing a stale lock, which needs the recovery file removed by hand.
 */
export class LockFileRecoveryError extends Error {
	constructor(
		readonly recoveryPath: string
	) {
		super(`Lock file recovery was interrupted, remove ${recoveryPath} to allow the lock to be acquired`);
		this.name = "LockFileRecoveryError";
	}
}

type LockState = "idle" | "acquiring" | "acquired" | "releasing";
type LockSnapshot = { content: string, ino: bigint, mtimeNs: bigint };

/** Content and identity of a lock file, read through one handle so both belong to the same file */
async function readLock(filePath: string): Promise<LockSnapshot | undefined> {
	let handle;
	try {
		handle = await fs.open(filePath, "r");
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

/**
 * Content written to the lock file. The start time tells this process apart from an earlier one with
 * the same pid, and is the same for every copy of lib loaded in this process.
 */
function lockContent() {
	return `${process.pid} ${performance.timeOrigin}\n`;
}

/** True if the lock names a process that is still running, or may still be written to */
function lockIsLive(lock: LockSnapshot) {
	const pid = Number(lock.content.split(" ")[0]);
	if (!Number.isInteger(pid) || pid <= 0) {
		return Date.now() - Number(lock.mtimeNs / 1000000n) < lockWriteGraceMs;
	}
	if (pid === process.pid) {
		// Held by this process, or left by an earlier process with the same pid
		return lock.content === lockContent();
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
 * Cross-platform lock file utility for Node.js.
 */
export class LockFile {
	private handle: FileHandle | null = null;
	private state: LockState = "idle";

	/**
	 * @param filePath - Path of the lock file
	 * @param handleSignals -
	 *     Release the lock on SIGINT, SIGTERM, SIGHUP and uncaught exceptions. Listening to these
	 *     changes how the process exits, so without it the lock is only removed on exit.
	 */
	constructor(
		private readonly filePath: string,
		private readonly handleSignals = true,
	) {}

	/**
	 * Acquire the lock file.
	 * Throws LockFileExistsError if already locked.
	 * Throws LockFileBusyError if not in idle state.
	 * Throws LockFileRecoveryError if clearing a stale lock was interrupted.
	 */
	async acquire(): Promise<void> {
		if (this.state !== "idle") {
			throw new LockFileBusyError(`Cannot acquire lock, current state is "${this.state}"`);
		}

		this.state = "acquiring";

		try {
			await this.removeStale();
			this.handle = await fs.open(this.filePath, "wx");
			await this.handle.write(lockContent());
			this.attachExitHandlers();
			this.state = "acquired";
		} catch (err: any) {
			this.state = "idle";
			if (err?.code === "EEXIST") {
				throw new LockFileExistsError(this.filePath);
			}
			throw err;
		}
	}

	/**
	 * Release the lock file.
	 * Throws LockFileBusyError if not in acquired state.
	 */
	async release(): Promise<void> {
		if (this.state !== "acquired") {
			throw new LockFileBusyError(`Cannot release lock, current state is "${this.state}"`);
		}

		this.state = "releasing";
		this.detachExitHandlers();

		// Ignored: file may have already been removed by another process
		try { await this.handle?.close(); } catch {}
		if (await this.isHeldFile()) {
			await fs.unlink(this.filePath).catch(() => {});
		}

		this.handle = null;
		this.state = "idle";
	}

	/**
	 * Check whether the lock is currently held by this process.
	 * True only if the lock is acquired and the lock file was written by this process.
	 */
	async isHeld(): Promise<boolean> {
		if (this.state !== "acquired") {
			return false;
		}
		return await this.isHeldFile();
	}

	private async isHeldFile() {
		try {
			return await fs.readFile(this.filePath, "utf8") === lockContent();
		} catch {
			// Ignored: file may not exist or be unreadable, so lock is not held
			return false;
		}
	}

	/**
	 * Determine whether an existing lock is stale.
	 */
	async isStale(): Promise<boolean> {
		const lock = await readLock(this.filePath);
		return lock === undefined || !lockIsLive(lock);
	}

	/** Pid of the process holding the lock, if it has written it */
	async holderPid(): Promise<number | undefined> {
		const pid = Number((await readLock(this.filePath))?.content.split(" ")[0]);
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	}

	/**
	 * Remove a stale lock file if it is still the same file. Clearing is done while holding a separate
	 * recovery lock, so a lock another process took after the stale check is never removed.
	 */
	private async removeStale(): Promise<void> {
		const stale = await readLock(this.filePath);
		if (!stale || lockIsLive(stale)) {
			return;
		}
		const recoveryPath = `${this.filePath}.recovery`;
		try {
			await fs.writeFile(recoveryPath, lockContent(), { flag: "wx" });
		} catch (err: any) {
			if (err.code !== "EEXIST") {
				throw err;
			}
			const holder = await readLock(recoveryPath);
			if (holder && !lockIsLive(holder)) {
				throw new LockFileRecoveryError(recoveryPath);
			}
			return; // Another process is clearing it
		}
		try {
			const current = await readLock(this.filePath);
			if (current && isSameLock(current, stale)) {
				await fs.unlink(this.filePath);
			}
		} finally {
			await fs.unlink(recoveryPath).catch(() => {});
		}
	}

	/**
	 * Attach process handlers, called when transitioning to "acquired"
	 */
	private attachExitHandlers(): void {
		assert(this.state === "acquiring");
		if (this.handleSignals) {
			process.on("SIGINT", this.handleExit);
			process.on("SIGTERM", this.handleExit);
			process.on("SIGHUP", this.handleExit);
			process.on("uncaughtException", this.handleExit);
		}
		// eslint-disable-next-line node/no-sync
		process.on("exit", this.handleExitSync);
	}

	/**
	 * Detach process handlers, called when transitioning to "idle"
	 */
	private detachExitHandlers(): void {
		assert(this.state === "releasing");
		process.off("SIGINT", this.handleExit);
		process.off("SIGTERM", this.handleExit);
		process.off("SIGHUP", this.handleExit);
		process.off("uncaughtException", this.handleExit);
		// eslint-disable-next-line node/no-sync
		process.off("exit", this.handleExitSync);
	}

	// Event handler for async signals / exceptions
	private handleExit = async (): Promise<void> => {
		await this.release();
	};

	// Event handler for synchronous process exit
	private handleExitSync = (): void => {
		try {
			if (readFileSync(this.filePath, "utf8") === lockContent()) {
				unlinkSync(this.filePath);
			}
		} catch (err) {
			// Ignored: file may have already been removed by another process
		}
	};
}
