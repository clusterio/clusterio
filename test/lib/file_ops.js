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

		await fs.outputFile(path.join(baseDir, "test", "file.txt"), "contents");
		await fs.outputFile(path.join(baseDir, "test", "another file.txt"), "more contents");
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
});
