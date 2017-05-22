var assert = require('assert');
var fileOps = require('./fileOps');

describe("fileOps.js", function(){
	describe("fileOps.getDirectoriesSync()", function(){
		it("gets an array of directory names from a path", function(){
			let directories = fileOps.getDirectoriesSync("lib/test");
			
			// because there are no arrays for some reason
			assert(typeof directories == "object");
			
			// they are sorted alphabetically because thats the way it is
			assert(directories[0] == "another folder" && directories[1] == "folder");
		});
		it("does not return any filenames", function(){
			let directories = fileOps.getDirectoriesSync("lib/test");
			
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
			let files = fileOps.getFileNamesSync("lib/test");
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
			fileOps.getNewestFile("lib/test", fileOps.getFileNamesSync("lib/test"), function(err, newest){
				assert(newest && typeof newest.file == "string");
				done();
			});
		});
		it("throws if callback is missing", function(){
			assert.throws(function(){
				fileOps.getNewestFile("lib/test", fileOps.getFileNamesSync("lib/test"));
			}, Error);
		});
		it("executes callback(err) if no files are provided", function(done){
			fileOps.getNewestFile("lib/test", [], function(err, newest){
				assert(err && typeof err == "object");
				done();
			});
		});
		it("executes callback(err) if launched without a directory", function(done){
			fileOps.getNewestFile("", fileOps.getFileNamesSync("lib/test"), function(err, newest){
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
});
