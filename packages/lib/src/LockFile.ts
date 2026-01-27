import { FileHandle, open, unlink, readFile } from "fs/promises";
import { unlinkSync } from "fs";
import assert from "assert";

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

type LockState = "idle" | "acquiring" | "acquired" | "releasing";

/**
 * Cross-platform lock file utility for Node.js.
 */
export class LockFile {
	private handle: FileHandle | null = null;
	private state: LockState = "idle";

	constructor(
		private readonly filePath: string
	) {}

	/**
	 * Acquire the lock file.
	 * Throws LockFileExistsError if already locked.
	 * Throws LockFileBusyError if not in idle state.
	 */
	async acquire(): Promise<void> {
		if (this.state !== "idle") {
			throw new LockFileBusyError(`Cannot acquire lock, current state is "${this.state}"`);
		}

		this.state = "acquiring";

		if (await this.isStale()) {
			await unlink(this.filePath).catch(() => {}); // ignore errors, may already be removed
		}

		try {
			this.handle = await open(this.filePath, "wx");
			await this.handle.write(`${process.pid}\n`);
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
		try { await unlink(this.filePath); } catch {}

		this.handle = null;
		this.state = "idle";
	}

	/**
	 * Check whether the lock is currently held by this process.
	 * True only if the lock is acquired and the PID in the file
	 * matches the current process.
	 */
	async isHeld(): Promise<boolean> {
		if (this.state !== "acquired") {
			return false;
		}

		try {
			const pidInLock = Number(await readFile(this.filePath, "utf8"));
			return pidInLock === process.pid;
		} catch {
    		// Ignored: file may not exist or be unreadable, so lock is not held
			return false;
		}
	}

	/**
	 * Determine whether an existing lock is stale.
	 */
	async isStale(): Promise<boolean> {
		try {
			const pidInLock = Number(await readFile(this.filePath, "utf8"));
			if (!Number.isFinite(pidInLock)) { return true; }
			// signal 0 is a special case to test if a process exists
			process.kill(pidInLock, 0);
			return false;
		} catch {
			return true;
		}
	}

	/**
	 * Attach process handlers, called when transitioning to "acquired"
	 */
	private attachExitHandlers(): void {
		assert(this.state === "acquiring");
		process.on("SIGINT", this.handleExit);
		process.on("SIGTERM", this.handleExit);
		process.on("SIGHUP", this.handleExit);
		process.on("uncaughtException", this.handleExit);
		// eslint-disable-next-line node/no-sync
		process.on("exit", this.handleExitSync);
	}

	/**
	 * Detach process handlers, called when transitioning to "idle"
	 */
	private async detachExitHandlers(): Promise<void> {
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
			unlinkSync(this.filePath);
		} catch (err) {
      		// Ignored: file may have already been removed by another process
		}
	};
}
