const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fileOps = require('./fileOps');

// create folders for testing
function setupTestingEnv(){
	if (!fs.existsSync(path.resolve(__dirname, "database"))){
		fs.mkdirSync(path.resolve(__dirname, "database"));
	}
	if (!fs.existsSync(path.resolve(__dirname, "test"))){
		fs.mkdirSync(path.resolve(__dirname, "test"));
	}
	if (!fs.existsSync(path.resolve(__dirname, "test/folder"))){
		fs.mkdirSync(path.resolve(__dirname, "test/folder"));
	}
	if (!fs.existsSync(path.resolve(__dirname, "test/another folder"))){
		fs.mkdirSync(path.resolve(__dirname, "test/another folder"));
	}
	if (!fs.existsSync(path.resolve(__dirname, "test/file.txt"))){
		fs.writeFileSync(path.resolve(__dirname, "test/file.txt"), "contents");
	}
	if (!fs.existsSync(path.resolve(__dirname, "test/another file.txt"))){
		fs.writeFileSync(path.resolve(__dirname, "test/another file.txt"), "more contents");
	}
	// we need this xfile to test a branch in fileOps.getNewestFile()s propagation
	if (!fs.existsSync(path.resolve(__dirname, "test/xfile.txt"))){
		fs.writeFileSync(path.resolve(__dirname, "test/xfile.txt"), "contents");
	}
}
setupTestingEnv();
setupTestingEnv(); // run twice to get branch coverage
describe("fileOps.js", function(){
	describe("fileOps.getDirectoriesSync()", function(){
		it("gets an array of directory names from a path", function(){
			let directories = fileOps.getDirectoriesSync(path.resolve(__dirname, "test"));
			
			// because there are no arrays for some reason
			assert(typeof directories == "object");
			
			// they are sorted alphabetically because thats the way it is
			assert(directories[0] == "another folder" && directories[1] == "folder");
		});
		it("does not return any filenames", function(){
			let directories = fileOps.getDirectoriesSync(path.resolve(__dirname, "test"));
			
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
			let files = fileOps.getFileNamesSync(path.resolve(__dirname, "test"));
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
		it("gets the newest file in a directory async", function(done){
			fileOps.getNewestFile(path.resolve(__dirname, "test/"), fileOps.getFileNamesSync(path.resolve(__dirname, "test")), function(err, newest){
				assert(newest && typeof newest.file == "string");
				done();
			});
		});
		it("throws if callback is missing", function(){
			assert.throws(function(){
				fileOps.getNewestFile("test", fileOps.getFileNamesSync(path.resolve(__dirname, "test")));
			}, Error);
		});
		it("executes callback(err) if no files are provided", function(done){
			fileOps.getNewestFile(path.resolve(__dirname, "test"), [], function(err, newest){
				assert(err && typeof err == "object");
				done();
			});
		});
		it("executes callback(err) if launched without a directory", function(done){
			fileOps.getNewestFile("", fileOps.getFileNamesSync(path.resolve(__dirname, "test")), function(err, newest){
				assert(err);
				done();
			});
		});
		it("executes callback(err) when you do stupid shit", function(done){
			fileOps.getNewestFile({thisWontWork: "but not crash either"}, {lolz:"yeah..."}, function(err, newest){
				assert(err);
				// ENOENT: no such file or directory, stat 'C:\**\factorioClusterio\lib\test\undefined'
				done();
			});
		});
	});
	describe("fileOps.deleteFolderRecursiveSync(path)", function(){
		it("deletes a folder and all files and folders in it", function(){
			let x = fileOps.deleteFolderRecursiveSync(path.resolve(__dirname, "test"));
			assert.throws(function(){
				fs.statSync(path.resolve(__dirname, "test"));
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
			setupTestingEnv();
			assert(fs.statSync(path.resolve(__dirname, "test")));
			let x = await fileOps.deleteFolderRecursive(path.resolve(__dirname, "test"));
			assert.throws(function(){
				fs.statSync(path.resolve(__dirname, "test"));
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
