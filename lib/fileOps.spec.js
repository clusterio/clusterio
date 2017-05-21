var assert = require('assert');
var fileOps = require('./fileOps');

describe("fileOps.js", function(){
	describe("fileOps.getDirectories()", function(){
		it("gets an array of directory names from a path", function(){
			let directories = fileOps.getDirectories("lib/test");
			
			// because there are no arrays for some reason
			assert(typeof directories == "object");
			
			// they are sorted alphabetically because thats the way it is
			assert(directories[0] == "another folder" && directories[1] == "folder");
		});
		it("does not return any filenames", function(){
			let directories = fileOps.getDirectories("lib/test");
			
			// this is a function to return directories, not files. So yeah.
			assert(!directories.includes("file.txt") && !directories.includes("another file.txt"));
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
	/*describe("fileOps.getNewestFile()", function(){
		it("gets the newest file in a directory async", function(done){
			fileOps.getNewestFile("lib/test", fileOps.getFileNames("lib/test"), function(newest){
				assert(newest);
				done();
			})
			
		});
	});*/
});
