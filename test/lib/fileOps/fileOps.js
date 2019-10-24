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

	describe("fileOps.getDirectoriesSync()", function(){
		it("gets an array of directory names from a path", function(){
			let directories = fileOps.getDirectoriesSync(path.join(baseDir, "test"));
			
			// because there are no arrays for some reason
			assert(typeof directories == "object");
			
			// they are sorted alphabetically because thats the way it is
			assert(directories[0] == "another folder" && directories[1] == "folder");
		});
		it("does not return any filenames", function(){
			let directories = fileOps.getDirectoriesSync(path.join(baseDir, "test"));
			
			// this is a function to return directories, not files. So yeah.
			assert(!directories.includes("file.txt") && !directories.includes("another file.txt"));
		});
		it("throws when lacking first argument", function(){
			assert.throws(function(){
				let files = fileOps.getDirectoriesSync();
			}, Error);
		});
	});
	describe("fileOps.getFileNamesSync(path)", function(){
		it("gets names of files in directory", function(){
			let files = fileOps.getFileNamesSync(path.join(baseDir, "test"));
			assert(files.length > 0);
			assert(files.includes("file.txt") && files.includes("another file.txt"));
		});
		it("throws when lacking first argument", function(){
			assert.throws(function(){
				let files = fileOps.getFileNamesSync();
			}, Error);
		});
	});
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
	describe("fileOps.deleteFolderRecursiveSync(path)", function(){
		it("deletes a folder and all files and folders in it", function(){
			let x = fileOps.deleteFolderRecursiveSync(path.join(baseDir, "test"));
			assert.throws(function(){
				fs.statSync(path.join(baseDir, "test"));
			}, Error);
			assert(x);
			// give it some extra time because its sometimes very slow
		}).timeout(5000);
		it("returns false if you give it an invalid path", function(){
			let x = fileOps.deleteFolderRecursiveSync("This isn't a real path");
			assert(!x);
		});
	});
	describe("fileOps.deleteFolderRecursive(path)", function(){
		it("deletes a folder and all files and folders in it, just like sync version", async function(){
			await setupTestingEnv();
			assert(fs.statSync(path.join(baseDir, "test")));
			let x = await fileOps.deleteFolderRecursive(path.join(baseDir, "test"));
			assert.throws(function(){
				fs.statSync(path.join(baseDir, "test"));
			}, Error);
			assert(x === undefined, "Promise version of this function does not have a return value upon success");
			return true;
		}).timeout(5000);
		it("throws like a promise does if you give it an invalid path", async function(){
			let x = await fileOps.deleteFolderRecursive("Look this path is fake!")
			.catch(e => {
				assert(e);
				assert.equal(e.code, "ENOENT");
				return true;
			});
		});
	});
});
