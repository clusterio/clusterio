const assert = require('assert').strict;
const fs = require('fs-extra');
const path = require('path');

const fileOps = require('lib/fileOps');

describe("fileOps.js", function(){
	let baseDir = path.join("test", "temp", "fileOps");
	async function setupTestingEnv() {
		await fs.ensureDir(path.join(baseDir, "test", "folder"));
		await fs.ensureDir(path.join(baseDir, "test", "another folder"));

		await fs.outputFile(path.join(baseDir, "test", "file.txt"), "contents");
		await fs.outputFile(path.join(baseDir, "test", "another file.txt"), "more contents");
	}

	before(setupTestingEnv);

	describe("fileOps.getNewestFile()", function(){
		it("returns a string in a directory with files", async function() {
			let newest = await fileOps.getNewestFile(path.join(baseDir, "test"));
			assert.equal(typeof newest, "string");
		});
		it("returns null if directory is empty", async function() {
			let newest = await fileOps.getNewestFile(path.join(baseDir, "test", "folder"));
			assert.equal(newest, null);
		});
	});
});
