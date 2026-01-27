/* eslint-disable node/no-sync */
"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const { LockFile } = require("@clusterio/lib");

const baseDir = path.join("temp", "test", "lock_file");

describe("class LockFile", function () {
	/** @type {string} */
	let filePath;
	/** @type {LockFile} */
	let lock;

	before(async function () {
		await fs.ensureDir(baseDir);
	});

	beforeEach(function() {
		filePath = path.join(baseDir, `${Date.now()}-${Math.random()}.lock`);
		lock = new LockFile(filePath);
	});

	afterEach(async function () {
		await fs.unlink(filePath).catch(() => {});
	});

	describe("acquire()", function () {
		it("should create the lock file when acquiring", async function () {
			await lock.acquire();
			assert.ok(fs.existsSync(filePath));
		});

		it("should throw LockFileBusyError if called when not idle", async function () {
			await lock.acquire();
			await assert.rejects(lock.acquire(), { name: "LockFileBusyError" });
		});

		it("should remove stale lock file and acquire it", async function () {
			await fs.writeFile(filePath, "999999\n"); // stale lock
			await lock.acquire();
			assert.ok(fs.existsSync(filePath));
		});

		it("should throw if existing lock file is not stale", async function () {
			await fs.writeFile(filePath, `${process.pid}\n`);
			await assert.rejects(lock.acquire(), { name: "LockFileExistsError" });
		});
	});

	describe("release()", function () {
		it("should remove the lock file when releasing", async function () {
			await lock.acquire();
			await lock.release();
			assert.ok(!fs.existsSync(filePath));
		});

		it("should throw LockFileBusyError if called when not acquired", async function () {
			await assert.rejects(lock.release(), { name: "LockFileBusyError" });
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
			await fs.writeFile(filePath, "999999\n"); // simulate another process
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

		it("should return true for invalid PID in lock file", async function () {
			await fs.writeFile(filePath, "abc\n"); // non-numeric PID
			const stale = await lock.isStale();
			assert.equal(stale, true);
		});

		it("should return true for non-existent process PID", async function () {
			await fs.writeFile(filePath, "999999\n"); // assume PID does not exist
			const stale = await lock.isStale();
			assert.equal(stale, true);
		});

		it("should return false for current process PID", async function () {
			await fs.writeFile(filePath, `${process.pid}\n`);
			const stale = await lock.isStale();
			assert.equal(stale, false);
		});
	});

	describe("attach/detach exit handlers", function () {
		it("should attach exit handler on acquire and detach on release", async function () {
			await lock.acquire();
			const listenersBefore = process.listeners("exit").slice();
			assert.ok(listenersBefore.includes(lock.handleExitSync));

			await lock.release();
			const listenersAfter = process.listeners("exit").slice();
			assert.ok(!listenersAfter.includes(lock.handleExitSync));
		});
	});

	describe("handleExitSync()", function () {
		it("should not throw if file already removed", function () {
			assert.doesNotThrow(() => lock.handleExitSync()); // simulate non-existent file
		});
	});
});
