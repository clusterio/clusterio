/* eslint-disable node/no-sync */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { LockFile } from "@clusterio/lib";

const baseDir = path.join("temp", "test", "lock_file");
const ownContent = `${process.pid} ${performance.timeOrigin}\n`;
// The parent process (mocha) is alive but isn't this process
const otherContent = `${process.ppid}\n`;
const exitedContent = "999999999\n";

describe("class LockFile", function () {
	/** @type {string} */
	let filePath;
	/** @type {string} */
	let recoveryPath;
	/** @type {LockFile} */
	let lock;
	const writeFile = fs.writeFile;

	before(async function () {
		await fs.mkdir(baseDir, { recursive: true });
	});

	beforeEach(function() {
		filePath = path.join(baseDir, `${Date.now()}-${Math.random()}.lock`);
		recoveryPath = `${filePath}.recovery`;
		lock = new LockFile(filePath);
	});

	afterEach(async function () {
		fs.writeFile = writeFile;
		if (await lock.isHeld()) {
			await lock.release();
		}
		await fs.unlink(filePath).catch(() => {});
		await fs.unlink(recoveryPath).catch(() => {});
	});

	async function writeOld(content) {
		await fs.writeFile(filePath, content);
		const old = new Date(Date.now() - 60e3);
		await fs.utimes(filePath, old, old);
		return old;
	}

	describe("acquire()", function () {
		it("should create the lock file when acquiring", async function () {
			await lock.acquire();
			assert.equal(await fs.readFile(filePath, "utf8"), ownContent);
		});

		it("should throw LockFileBusyError if called when not idle", async function () {
			await lock.acquire();
			await assert.rejects(lock.acquire(), { name: "LockFileBusyError" });
		});

		it("should remove stale lock file and acquire it", async function () {
			await fs.writeFile(filePath, exitedContent);
			await lock.acquire();
			assert.equal(await fs.readFile(filePath, "utf8"), ownContent);
			await assert.rejects(fs.access(recoveryPath));
		});

		it("should throw if existing lock file is not stale", async function () {
			await fs.writeFile(filePath, otherContent);
			await assert.rejects(lock.acquire(), { name: "LockFileExistsError" });
		});

		it("should throw if another lock in this process holds the file", async function () {
			const other = new LockFile(filePath);
			await other.acquire();
			await assert.rejects(lock.acquire(), { name: "LockFileExistsError" });
			await other.release();
		});

		it("should acquire a lock left by an earlier process with the same pid", async function () {
			for (const content of [`${process.pid}\n`, `${process.pid} 1234.5\n`]) {
				await fs.writeFile(filePath, content);
				await lock.acquire();
				await lock.release();
			}
		});

		it("should throw while the lock file may still be being written", async function () {
			await fs.writeFile(filePath, "");
			await assert.rejects(lock.acquire(), { name: "LockFileExistsError" });
		});

		it("should acquire an unreadable lock that is old", async function () {
			await writeOld("");
			await lock.acquire();
		});

		// Runs takeOver right before this process starts clearing the stale lock, as another process could
		function beforeRecovery(takeOver) {
			fs.writeFile = async function(...args) {
				if (String(args[0]).endsWith(".recovery")) {
					fs.writeFile = writeFile;
					await takeOver();
				}
				return writeFile(...args);
			};
		}

		it("should leave a lock taken after the stale check in place", async function () {
			await fs.writeFile(filePath, exitedContent);
			beforeRecovery(async () => {
				await fs.rm(filePath);
				await fs.writeFile(filePath, otherContent);
			});
			await assert.rejects(lock.acquire(), { name: "LockFileExistsError" });
			assert.equal(await fs.readFile(filePath, "utf8"), otherContent);
			await assert.rejects(fs.access(recoveryPath));
		});

		it("should leave a new empty lock in place of an old empty lock", async function () {
			const old = await writeOld("");
			// Another process clears it and creates a new lock that it hasn't written its pid to yet
			beforeRecovery(async () => {
				await fs.rm(filePath);
				await fs.writeFile(filePath, "");
			});
			await assert.rejects(lock.acquire(), { name: "LockFileExistsError" });
			assert.equal(await fs.readFile(filePath, "utf8"), "");
			assert((await fs.stat(filePath)).mtimeMs > old.getTime() + 30e3);
		});

		it("should leave a stale lock alone while another process clears it", async function () {
			await fs.writeFile(filePath, exitedContent);
			await fs.writeFile(recoveryPath, otherContent);
			await assert.rejects(lock.acquire(), { name: "LockFileExistsError" });
			assert.equal(await fs.readFile(filePath, "utf8"), exitedContent);
			assert.equal(await fs.readFile(recoveryPath, "utf8"), otherContent);
		});

		it("should throw LockFileRecoveryError if clearing a stale lock was interrupted", async function () {
			await fs.writeFile(filePath, exitedContent);
			await fs.writeFile(recoveryPath, exitedContent);
			await assert.rejects(lock.acquire(), { name: "LockFileRecoveryError" });
		});
	});

	describe("release()", function () {
		it("should remove the lock file when releasing", async function () {
			await lock.acquire();
			await lock.release();
			await assert.rejects(fs.access(filePath));
		});

		it("should throw LockFileBusyError if called when not acquired", async function () {
			await assert.rejects(lock.release(), { name: "LockFileBusyError" });
		});

		it("should leave a lock file it does not own in place", async function () {
			await lock.acquire();
			await fs.writeFile(filePath, otherContent);
			await lock.release();
			assert.equal(await fs.readFile(filePath, "utf8"), otherContent);
		});
	});

	describe("isHeld()", function () {
		it("should return true only when lock file contains current PID", async function () {
			await lock.acquire();
			const held = await lock.isHeld();
			assert.equal(held, true);
		});

		it("should return false when lock file does not exist", async function () {
			const held = await lock.isHeld();
			assert.equal(held, false);
		});

		it("should return false if lock file contains different PID", async function () {
			await fs.writeFile(filePath, otherContent);
			const held = await lock.isHeld();
			assert.equal(held, false);
		});

		it("should return false if lock file was deleted while held", async function() {
			await lock.acquire();
			await fs.unlink(filePath);
			const held = await lock.isHeld();
			assert.equal(held, false);
		});
	});

	describe("isStale()", function () {
		it("should return true if lock file does not exist", async function () {
			const stale = await lock.isStale();
			assert.equal(stale, true);
		});

		it("should return true for invalid PID in an old lock file", async function () {
			await writeOld("abc\n");
			const stale = await lock.isStale();
			assert.equal(stale, true);
		});

		it("should return false for invalid PID in a new lock file", async function () {
			await fs.writeFile(filePath, "abc\n");
			const stale = await lock.isStale();
			assert.equal(stale, false);
		});

		it("should return true for non-existent process PID", async function () {
			await fs.writeFile(filePath, exitedContent);
			const stale = await lock.isStale();
			assert.equal(stale, true);
		});

		it("should return false for another running process", async function () {
			await fs.writeFile(filePath, otherContent);
			const stale = await lock.isStale();
			assert.equal(stale, false);
		});

		it("should return false for a lock taken by this process", async function () {
			await lock.acquire();
			const stale = await new LockFile(filePath).isStale();
			assert.equal(stale, false);
		});

		it("should return true for an earlier process with the same pid", async function () {
			await fs.writeFile(filePath, `${process.pid}\n`);
			const stale = await lock.isStale();
			assert.equal(stale, true);
		});
	});

	describe("holderPid()", function () {
		it("should return the pid in the lock file", async function () {
			await fs.writeFile(filePath, `${process.ppid} 1234.5\n`);
			assert.equal(await lock.holderPid(), process.ppid);
		});

		it("should return undefined without a valid pid", async function () {
			assert.equal(await lock.holderPid(), undefined);
			await fs.writeFile(filePath, "");
			assert.equal(await lock.holderPid(), undefined);
		});
	});

	describe("attach/detach exit handlers", function () {
		it("should attach exit handler on acquire and detach on release", async function () {
			await lock.acquire();
			const listenersBefore = process.listeners("exit").slice();
			assert.ok(listenersBefore.includes(lock.handleExitSync));
			assert.ok(process.listeners("SIGTERM").includes(lock.handleExit));

			await lock.release();
			const listenersAfter = process.listeners("exit").slice();
			assert.ok(!listenersAfter.includes(lock.handleExitSync));
			assert.ok(!process.listeners("SIGTERM").includes(lock.handleExit));
		});

		it("should only attach the exit handler without handleSignals", async function () {
			lock = new LockFile(filePath, false);
			await lock.acquire();
			assert.ok(process.listeners("exit").includes(lock.handleExitSync));
			for (const event of ["SIGINT", "SIGTERM", "SIGHUP", "uncaughtException"]) {
				assert.ok(!process.listeners(event).includes(lock.handleExit), event);
			}
		});
	});

	describe("handleExitSync()", function () {
		it("should not throw if file already removed", function () {
			assert.doesNotThrow(() => lock.handleExitSync()); // simulate non-existent file
		});

		it("should only remove a lock file it owns", async function () {
			await fs.writeFile(filePath, otherContent);
			lock.handleExitSync();
			assert.equal(fsSync.readFileSync(filePath, "utf8"), otherContent);
			await fs.writeFile(filePath, ownContent);
			lock.handleExitSync();
			assert.equal(fsSync.existsSync(filePath), false);
		});
	});
});
