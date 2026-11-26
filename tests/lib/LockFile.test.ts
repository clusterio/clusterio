import t from "tap";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import * as lib from "@clusterio/lib";

const ownContent = `${process.pid} ${performance.timeOrigin}\n`;
// The parent process (tap) is alive but isn't this process
const otherContent = `${process.ppid}\n`;
const exitedContent = "999999999\n";
const signalEvents = ["SIGINT", "SIGTERM", "SIGHUP", "uncaughtException"];

// A lock in a fresh directory that is released when the test ends
function setup(t1: any, handleSignals?: boolean) {
	const dir = t1.testdir();
	const filePath = path.join(dir, "test.lock");
	const recoveryPath = `${filePath}.recovery`;
	const lock = new lib.LockFile(filePath, handleSignals);
	t1.teardown(async () => {
		if ((lock as any).state === "acquired") {
			await lock.release();
		}
	});
	return { dir, filePath, recoveryPath, lock };
}

async function writeOld(filePath: string, content: string) {
	await fs.writeFile(filePath, content);
	const old = new Date(Date.now() - 60e3);
	await fs.utimes(filePath, old, old);
	return old;
}

// Runs takeOver right before the lock starts clearing a stale lock, as another process could
function beforeRecovery(t1: any, takeOver: () => Promise<void>) {
	const writeFile = fs.writeFile;
	let done = false;
	t1.intercept(fs, "writeFile", {
		value: async (...args: Parameters<typeof fs.writeFile>) => {
			if (!done && String(args[0]).endsWith(".recovery")) {
				done = true;
				await takeOver();
			}
			return await writeFile(...args);
		},
	});
}

t.test("errors", async t1 => {
	t1.test("LockFileExistsError", async t2 => {
		const err = new lib.LockFileExistsError("a.lock");
		t2.equal(err.name, "LockFileExistsError");
		t2.equal(err.filePath, "a.lock");
		t2.equal(err.message, "Cannot acquire lock, a valid lock file exists at a.lock");
	});
	t1.test("LockFileBusyError", async t2 => {
		const err = new lib.LockFileBusyError("busy");
		t2.equal(err.name, "LockFileBusyError");
		t2.equal(err.message, "busy");
	});
	t1.test("LockFileRecoveryError", async t2 => {
		const err = new lib.LockFileRecoveryError("a.lock.recovery");
		t2.equal(err.name, "LockFileRecoveryError");
		t2.equal(err.recoveryPath, "a.lock.recovery");
		t2.equal(
			err.message,
			"Lock file recovery was interrupted, remove a.lock.recovery to allow the lock to be acquired",
		);
	});
});

t.test("LockFile", async t1 => {
	t1.test("acquire()", async t2 => {
		t2.test("creates the lock file", async t3 => {
			const { filePath, lock } = setup(t3);
			await lock.acquire();
			t3.equal(await fs.readFile(filePath, "utf8"), ownContent);
			t3.equal(await lock.isHeld(), true);
		});
		t2.test("rejects with LockFileBusyError when not idle", async t3 => {
			const { lock } = setup(t3);
			await lock.acquire();
			await t3.rejects(
				lock.acquire(),
				new lib.LockFileBusyError("Cannot acquire lock, current state is \"acquired\""),
			);
		});
		t2.test("rejects with LockFileBusyError while acquiring", async t3 => {
			const { lock } = setup(t3);
			const acquiring = lock.acquire();
			await t3.rejects(
				lock.acquire(),
				new lib.LockFileBusyError("Cannot acquire lock, current state is \"acquiring\""),
			);
			await acquiring;
		});
		t2.test("removes a stale lock and acquires it", async t3 => {
			const { filePath, recoveryPath, lock } = setup(t3);
			await fs.writeFile(filePath, exitedContent);
			await lock.acquire();
			t3.equal(await fs.readFile(filePath, "utf8"), ownContent);
			await t3.rejects(fs.access(recoveryPath), { code: "ENOENT" });
		});
		t2.test("rejects with LockFileExistsError if the lock is held by another process", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.writeFile(filePath, otherContent);
			await t3.rejects(lock.acquire(), new lib.LockFileExistsError(filePath));
			t3.equal(await fs.readFile(filePath, "utf8"), otherContent);
			t3.equal((lock as any).state, "idle");
		});
		t2.test("rejects if another lock in this process holds the file", async t3 => {
			const { filePath, lock } = setup(t3);
			const other = new lib.LockFile(filePath);
			await other.acquire();
			t3.teardown(() => other.release());
			await t3.rejects(lock.acquire(), new lib.LockFileExistsError(filePath));
		});
		t2.test("treats a process it may not signal as running", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.writeFile(filePath, "12345\n");
			t3.intercept(process, "kill", {
				value: () => { throw Object.assign(new Error("not permitted"), { code: "EPERM" }); },
			});
			await t3.rejects(lock.acquire(), new lib.LockFileExistsError(filePath));
		});
		t2.test("acquires a lock left by an earlier process with the same pid", async t3 => {
			const { filePath, lock } = setup(t3);
			for (const content of [`${process.pid}\n`, `${process.pid} 1234.5\n`]) {
				await fs.writeFile(filePath, content);
				await lock.acquire();
				await lock.release();
			}
		});
		t2.test("rejects while a lock without a pid may still be being written", async t3 => {
			const { filePath, lock } = setup(t3);
			for (const content of ["", "abc\n", "0\n", "-5\n", "1.5\n"]) {
				await fs.writeFile(filePath, content);
				await t3.rejects(lock.acquire(), new lib.LockFileExistsError(filePath), JSON.stringify(content));
			}
		});
		t2.test("acquires an old lock without a pid", async t3 => {
			const { filePath, lock } = setup(t3);
			await writeOld(filePath, "");
			await lock.acquire();
			t3.equal(await fs.readFile(filePath, "utf8"), ownContent);
		});
		t2.test("rejects other errors creating the lock file", async t3 => {
			const { dir } = setup(t3);
			const lock = new lib.LockFile(path.join(dir, "missing", "test.lock"));
			await t3.rejects(lock.acquire(), { code: "ENOENT" });
			t3.equal((lock as any).state, "idle");
		});
		t2.test("rejects errors reading the existing lock file", async t3 => {
			const { dir } = setup(t3);
			await fs.writeFile(path.join(dir, "file"), "");
			const lock = new lib.LockFile(path.join(dir, "file", "test.lock"));
			await t3.rejects(lock.acquire(), { code: "ENOTDIR" });
			t3.equal((lock as any).state, "idle");
		});
		t2.test("leaves a lock taken after the stale check in place", async t3 => {
			const { filePath, recoveryPath, lock } = setup(t3);
			await fs.writeFile(filePath, exitedContent);
			beforeRecovery(t3, async () => {
				await fs.rm(filePath);
				await fs.writeFile(filePath, otherContent);
			});
			await t3.rejects(lock.acquire(), new lib.LockFileExistsError(filePath));
			t3.equal(await fs.readFile(filePath, "utf8"), otherContent);
			await t3.rejects(fs.access(recoveryPath), { code: "ENOENT" });
		});
		t2.test("acquires when the stale lock is removed after the stale check", async t3 => {
			const { filePath, recoveryPath, lock } = setup(t3);
			await fs.writeFile(filePath, exitedContent);
			beforeRecovery(t3, async () => {
				await fs.rm(filePath);
			});
			await lock.acquire();
			t3.equal(await fs.readFile(filePath, "utf8"), ownContent);
			await t3.rejects(fs.access(recoveryPath), { code: "ENOENT" });
		});
		t2.test("leaves a new empty lock in place of an old empty lock", async t3 => {
			const { filePath, lock } = setup(t3);
			const old = await writeOld(filePath, "");
			// Another process clears it and creates a new lock that it hasn't written its pid to yet
			beforeRecovery(t3, async () => {
				await fs.rm(filePath);
				await fs.writeFile(filePath, "");
			});
			await t3.rejects(lock.acquire(), new lib.LockFileExistsError(filePath));
			t3.equal(await fs.readFile(filePath, "utf8"), "");
			t3.ok((await fs.stat(filePath)).mtimeMs > old.getTime() + 30e3);
		});
		t2.test("leaves a stale lock alone while another process clears it", async t3 => {
			const { filePath, recoveryPath, lock } = setup(t3);
			await fs.writeFile(filePath, exitedContent);
			await fs.writeFile(recoveryPath, otherContent);
			await t3.rejects(lock.acquire(), new lib.LockFileExistsError(filePath));
			t3.equal(await fs.readFile(filePath, "utf8"), exitedContent);
			t3.equal(await fs.readFile(recoveryPath, "utf8"), otherContent);
		});
		t2.test("leaves a stale lock alone when another process just finished clearing it", async t3 => {
			const { filePath, recoveryPath, lock } = setup(t3);
			await fs.writeFile(filePath, exitedContent);
			// The recovery file is gone by the time it is read
			const writeFile = fs.writeFile;
			t3.intercept(fs, "writeFile", {
				value: async (...args: Parameters<typeof fs.writeFile>) => {
					if (String(args[0]) === recoveryPath) {
						throw Object.assign(new Error("exists"), { code: "EEXIST" });
					}
					return await writeFile(...args);
				},
			});
			await t3.rejects(lock.acquire(), new lib.LockFileExistsError(filePath));
			t3.equal(await fs.readFile(filePath, "utf8"), exitedContent);
		});
		t2.test("rejects with LockFileRecoveryError if clearing a stale lock was interrupted", async t3 => {
			const { filePath, recoveryPath, lock } = setup(t3);
			await fs.writeFile(filePath, exitedContent);
			await fs.writeFile(recoveryPath, exitedContent);
			await t3.rejects(lock.acquire(), new lib.LockFileRecoveryError(recoveryPath));
			t3.equal((lock as any).state, "idle");
		});
		t2.test("rejects other errors creating the recovery file", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.writeFile(filePath, exitedContent);
			const error = Object.assign(new Error("denied"), { code: "EACCES" });
			t3.intercept(fs, "writeFile", { value: async () => { throw error; } });
			await t3.rejects(lock.acquire(), error);
			t3.equal(await fs.readFile(filePath, "utf8"), exitedContent);
		});
		t2.test("attaches exit and signal handlers", async t3 => {
			const { lock } = setup(t3);
			await lock.acquire();
			t3.ok(process.listeners("exit").includes((lock as any).handleExitSync));
			for (const event of signalEvents) {
				t3.ok(process.listeners(event as any).includes((lock as any).handleExit), event);
			}
		});
		t2.test("attaches only the exit handler without handleSignals", async t3 => {
			const { lock } = setup(t3, false);
			await lock.acquire();
			t3.ok(process.listeners("exit").includes((lock as any).handleExitSync));
			for (const event of signalEvents) {
				t3.notOk(process.listeners(event as any).includes((lock as any).handleExit), event);
			}
		});
	});

	t1.test("release()", async t2 => {
		t2.test("removes the lock file and handlers", async t3 => {
			const { filePath, lock } = setup(t3);
			await lock.acquire();
			await lock.release();
			await t3.rejects(fs.access(filePath), { code: "ENOENT" });
			t3.equal((lock as any).state, "idle");
			t3.notOk(process.listeners("exit").includes((lock as any).handleExitSync));
			for (const event of signalEvents) {
				t3.notOk(process.listeners(event as any).includes((lock as any).handleExit), event);
			}
		});
		t2.test("allows acquiring again", async t3 => {
			const { lock } = setup(t3);
			await lock.acquire();
			await lock.release();
			await lock.acquire();
			t3.equal(await lock.isHeld(), true);
		});
		t2.test("rejects with LockFileBusyError when not acquired", async t3 => {
			const { lock } = setup(t3);
			await t3.rejects(
				lock.release(),
				new lib.LockFileBusyError("Cannot release lock, current state is \"idle\""),
			);
		});
		t2.test("leaves a lock file it does not own in place", async t3 => {
			const { filePath, lock } = setup(t3);
			await lock.acquire();
			await fs.writeFile(filePath, otherContent);
			await lock.release();
			t3.equal(await fs.readFile(filePath, "utf8"), otherContent);
		});
		t2.test("succeeds if the lock file was removed", async t3 => {
			const { filePath, lock } = setup(t3);
			await lock.acquire();
			await fs.rm(filePath);
			await lock.release();
			t3.equal((lock as any).state, "idle");
		});
		t2.test("ignores errors closing the handle", async t3 => {
			const { filePath, lock } = setup(t3);
			await lock.acquire();
			t3.intercept((lock as any).handle, "close", { value: async () => { throw new Error("close failed"); } });
			await lock.release();
			await t3.rejects(fs.access(filePath), { code: "ENOENT" });
		});
		t2.test("ignores errors removing the lock file", async t3 => {
			const { filePath, lock } = setup(t3);
			await lock.acquire();
			t3.intercept(fs, "unlink", { value: async () => { throw new Error("unlink failed"); } });
			await lock.release();
			t3.equal((lock as any).state, "idle");
			t3.equal(await fs.readFile(filePath, "utf8"), ownContent);
		});
	});

	t1.test("isHeld()", async t2 => {
		t2.test("returns true while acquired", async t3 => {
			const { lock } = setup(t3);
			await lock.acquire();
			t3.equal(await lock.isHeld(), true);
		});
		t2.test("returns false when not acquired", async t3 => {
			const { lock } = setup(t3);
			t3.equal(await lock.isHeld(), false);
		});
		t2.test("returns false when not acquired even if the file has our content", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.writeFile(filePath, ownContent);
			t3.equal(await lock.isHeld(), false);
		});
		t2.test("returns false if the lock file was replaced", async t3 => {
			const { filePath, lock } = setup(t3);
			await lock.acquire();
			await fs.writeFile(filePath, otherContent);
			t3.equal(await lock.isHeld(), false);
		});
		t2.test("returns false if the lock file was deleted", async t3 => {
			const { filePath, lock } = setup(t3);
			await lock.acquire();
			await fs.unlink(filePath);
			t3.equal(await lock.isHeld(), false);
		});
		t2.test("returns false if the lock file can't be read", async t3 => {
			const { filePath, lock } = setup(t3);
			await lock.acquire();
			await fs.unlink(filePath);
			await fs.mkdir(filePath);
			t3.equal(await lock.isHeld(), false);
			await fs.rmdir(filePath);
		});
	});

	t1.test("isStale()", async t2 => {
		t2.test("returns true if the lock file does not exist", async t3 => {
			const { lock } = setup(t3);
			t3.equal(await lock.isStale(), true);
		});
		t2.test("returns true for an invalid pid in an old lock file", async t3 => {
			const { filePath, lock } = setup(t3);
			await writeOld(filePath, "abc\n");
			t3.equal(await lock.isStale(), true);
		});
		t2.test("returns false for an invalid pid in a new lock file", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.writeFile(filePath, "abc\n");
			t3.equal(await lock.isStale(), false);
		});
		t2.test("returns true for a process that does not exist", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.writeFile(filePath, exitedContent);
			t3.equal(await lock.isStale(), true);
		});
		t2.test("returns false for another running process", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.writeFile(filePath, otherContent);
			t3.equal(await lock.isStale(), false);
		});
		t2.test("returns false for a lock taken by this process", async t3 => {
			const { filePath, lock } = setup(t3);
			await lock.acquire();
			t3.equal(await new lib.LockFile(filePath).isStale(), false);
		});
		t2.test("returns true for an earlier process with the same pid", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.writeFile(filePath, `${process.pid}\n`);
			t3.equal(await lock.isStale(), true);
		});
		t2.test("rejects errors reading the lock file", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.mkdir(filePath);
			await t3.rejects(lock.isStale(), { code: "EISDIR" });
		});
	});

	t1.test("holderPid()", async t2 => {
		t2.test("returns the pid in the lock file", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.writeFile(filePath, `${process.ppid} 1234.5\n`);
			t3.equal(await lock.holderPid(), process.ppid);
		});
		t2.test("returns undefined without a lock file", async t3 => {
			const { lock } = setup(t3);
			t3.equal(await lock.holderPid(), undefined);
		});
		t2.test("returns undefined without a valid pid", async t3 => {
			const { filePath, lock } = setup(t3);
			for (const content of ["", "abc\n", "0\n", "-1\n", "1.5\n"]) {
				await fs.writeFile(filePath, content);
				t3.equal(await lock.holderPid(), undefined, JSON.stringify(content));
			}
		});
	});

	t1.test("handleExit()", async t2 => {
		t2.test("releases the lock", async t3 => {
			const { filePath, lock } = setup(t3);
			await lock.acquire();
			await (lock as any).handleExit();
			t3.equal((lock as any).state, "idle");
			await t3.rejects(fs.access(filePath), { code: "ENOENT" });
		});
	});

	t1.test("handleExitSync()", async t2 => {
		t2.test("does not throw if the file is missing", async t3 => {
			const { lock } = setup(t3);
			// eslint-disable-next-line node/no-sync
			t3.doesNotThrow(() => (lock as any).handleExitSync());
		});
		t2.test("removes a lock file it owns", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.writeFile(filePath, ownContent);
			// eslint-disable-next-line node/no-sync
			(lock as any).handleExitSync();
			// eslint-disable-next-line node/no-sync
			t3.equal(fsSync.existsSync(filePath), false);
		});
		t2.test("leaves a lock file it does not own", async t3 => {
			const { filePath, lock } = setup(t3);
			await fs.writeFile(filePath, otherContent);
			// eslint-disable-next-line node/no-sync
			(lock as any).handleExitSync();
			t3.equal(await fs.readFile(filePath, "utf8"), otherContent);
		});
	});
});
