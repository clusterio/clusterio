"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const libFileOps = require("@clusterio/lib/file_ops");

describe("lib/file_ops", function() {
	let baseDir = path.join("temp", "test", "file_ops");
	async function setupTestingEnv() {
		await fs.ensureDir(path.join(baseDir, "test", "folder"));
		await fs.ensureDir(path.join(baseDir, "test", "another folder"));
		await fs.remove(path.join(baseDir, "safe"));
		await fs.ensureDir(path.join(baseDir, "safe"));

		await fs.outputFile(path.join(baseDir, "test", "file.txt"), "contents");
		await fs.outputFile(path.join(baseDir, "test", "another file.txt"), "more contents");

		await fs.outputFile(path.join(baseDir, "find", "file"), "contents");
		await fs.outputFile(path.join(baseDir, "find", "file.txt"), "contents");
		await fs.outputFile(path.join(baseDir, "find", "foo-1"), "contents");
		await fs.outputFile(path.join(baseDir, "find", "foo-2"), "contents");
		await fs.outputFile(path.join(baseDir, "find", "bar-1.txt"), "contents");
		await fs.outputFile(path.join(baseDir, "find", "bar-2.txt"), "contents");
	}

	before(setupTestingEnv);

	describe("getNewestFile()", function() {
		it("returns a string in a directory with files", async function() {
			let newest = await libFileOps.getNewestFile(path.join(baseDir, "test"));
			assert.equal(typeof newest, "string");
		});
		it("returns null if all entries were filtered out", async function() {
			let newest = await libFileOps.getNewestFile(path.join(baseDir, "test"), (name) => !name.endsWith(".txt"));
			assert.equal(newest, null);
		});
		it("returns null if directory is empty", async function() {
			let newest = await libFileOps.getNewestFile(path.join(baseDir, "test", "folder"));
			assert.equal(newest, null);
		});
	});

	describe("findUnusedName()", function() {
		it("should return named unchanged if it does not exist", async function() {
			let cases = [
				[["file"], "file"],
				[["file", ".txt"], "file.txt"],
				[["file.txt", ".txt"], "file.txt"],
			];
			for (let [args, expected] of cases) {
				let actual = await libFileOps.findUnusedName(path.join(baseDir, "test", "folder"), ...args);
				assert.equal(actual, expected);
			}
		});
		it("should return changed name if it does exist", async function() {
			let cases = [
				[["file"], "file-2"],
				[["file", ".txt"], "file-2.txt"],
				[["file.txt", ".txt"], "file-2.txt"],
				[["foo-1"], "foo-3"],
				[["bar-1", ".txt"], "bar-3.txt"],
				[["bar-1.txt", ".txt"], "bar-3.txt"],
			];
			for (let [args, expected] of cases) {
				let actual = await libFileOps.findUnusedName(path.join(baseDir, "find"), ...args);
				assert.equal(actual, expected);
			}
		});
	});

	describe("safeOutputFile()", function() {
		it("should write new target file", async function() {
			let target = path.join(baseDir, "safe", "simple.txt");
			await libFileOps.safeOutputFile(target, "a text file", "utf8");
			assert(!await fs.pathExists(`${target}.tmp`), "temporary was left behind");
			assert.equal(await fs.readFile(target, "utf8"), "a text file");
		});
		it("should overwrite existing target file", async function() {
			let target = path.join(baseDir, "safe", "exists.txt");
			await fs.outputFile(target, "previous", "utf8");
			await libFileOps.safeOutputFile(target, "current", "utf8");
			assert(!await fs.pathExists(`${target}.tmp`), "temporary was left behind");
			assert.equal(await fs.readFile(target, "utf8"), "current");
		});
	});
});
