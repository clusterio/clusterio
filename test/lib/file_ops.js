"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const lib = require("@clusterio/lib");

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
			let newest = await lib.getNewestFile(path.join(baseDir, "test"));
			assert.equal(typeof newest, "string");
		});
		it("returns undefined if all entries were filtered out", async function() {
			let newest = await lib.getNewestFile(path.join(baseDir, "test"), (name) => !name.endsWith(".txt"));
			assert.equal(newest, undefined);
		});
		it("returns undefined if directory is empty", async function() {
			let newest = await lib.getNewestFile(path.join(baseDir, "test", "folder"));
			assert.equal(newest, undefined);
		});
	});

	describe("getNewestFile()", function() {
		it("returns 0 if directory does not exist", async function() {
			let size = await lib.directorySize(path.join(baseDir, "invalid"));
			assert.equal(size, 0);
		});
		it("returns 0 if directory is empty", async function() {
			let size = await lib.directorySize(path.join(baseDir, "test", "folder"));
			assert.equal(size, 0);
		});
		it("returns size of files in directory", async function() {
			let size = await lib.directorySize(path.join(baseDir, "test"));
			assert.equal(size, 21);
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
				let actual = await lib.findUnusedName(path.join(baseDir, "test", "folder"), ...args);
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
				let actual = await lib.findUnusedName(path.join(baseDir, "find"), ...args);
				assert.equal(actual, expected);
			}
		});
	});

	describe("safeOutputFile()", function() {
		it("should write new target file", async function() {
			let target = path.join(baseDir, "safe", "simple.txt");
			await lib.safeOutputFile(target, "a text file", "utf8");
			assert(!await fs.pathExists(target.replace(".txt", ".tmp.txt")), "temporary was left behind");
			assert.equal(await fs.readFile(target, "utf8"), "a text file");
		});
		it("should overwrite existing target file", async function() {
			let target = path.join(baseDir, "safe", "exists.txt");
			await fs.outputFile(target, "previous", "utf8");
			await lib.safeOutputFile(target, "current", "utf8");
			assert(!await fs.pathExists(target.replace(".txt", ".tmp.txt")), "temporary was left behind");
			assert.equal(await fs.readFile(target, "utf8"), "current");
		});
		it("should handle creating file in current working directory", async function() {
			let target = "temporary-file-made-to-test-cwd.txt";
			try {
				await lib.safeOutputFile(target, "a text file", "utf8");
			} finally {
				try {
					await fs.unlink(target);
				} catch (err) {
					if (err.code !== "ENOENT") {
						throw err;
					}
				}
			}
		});
	});

	describe("checkFilename()", function() {
		it("should allow a basic name", function() {
			lib.checkFilename("file");
		});

		function check(item, msg) {
			assert.throws(() => lib.checkFilename(item), new Error(msg));
		}

		it("should throw on non-string", function() {
			check(undefined, "must be a string");
			check(null, "must be a string");
			check({}, "must be a string");
			check([], "must be a string");
			check(0, "must be a string");
			check(false, "must be a string");
		});

		it("should throw on empty name", function() {
			check("", "cannot be empty");
		});

		it("should throw on <>:\"\\/|?* \\x00\\r\\n\\t", function() {
			for (let char of '<>:"\\/|?*\x00\r\n\t') {
				check(char, 'cannot contain <>:"\\/|=* or control characters');
			}
		});

		it("should throw on CON, PRN, AUX, NUL, COM1, LPT1", function() {
			for (let bad of ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"]) {
				check(bad, "cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9");
				check(`${bad}.zip`, "cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9");
				check(`${bad}.anything.txt`, "cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9");
				check(`${bad}....a`, "cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9");
				check(`${bad}.`, "cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9");
			}
		});

		it("should throw on . and ..", function() {
			for (let bad of [".", ".."]) {
				check(bad, `cannot be named ${bad}`);
			}
		});

		it("should throw on names ending with . or space", function() {
			check("a ", "cannot end with . or space");
			check("a.", "cannot end with . or space");
		});
	});

	describe("cleanFilename()", function() {
		function clean(item, expected) {
			assert.equal(lib.cleanFilename(item), expected);
		}

		it("should allow a basic name", function() {
			clean("file", "file");
		});

		function check(item, msg) {
			assert.throws(() => lib.cleanFilename(item), new Error(msg));
		}

		it("should throw on non-string", function() {
			check(undefined, "name must be a string");
			check(null, "name must be a string");
			check({}, "name must be a string");
			check([], "name must be a string");
			check(0, "name must be a string");
			check(false, "name must be a string");
		});

		it("should clean empty name", function() {
			clean("", "_");
		});

		it("should clean <>:\"\\/|?* \\x00\\r\\n\\t", function() {
			for (let char of '<>:"\\/|?*\x00\r\n\t') {
				clean(char, "_");
			}
		});

		it("should clean CON, PRN, AUX, NUL, COM1, LPT1", function() {
			for (let bad of ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"]) {
				clean(bad, `${bad}_`);
				clean(`${bad}.zip`, `${bad}_.zip`);
				clean(`${bad}.anything.txt`, `${bad}_.anything.txt`);
				clean(`${bad}....a`, `${bad}_....a`);
				clean(`${bad}.`, `${bad}__`);
			}
		});

		it("should clean . and ..", function() {
			for (let bad of [".", ".."]) {
				clean(bad, `${bad}_`);
			}
		});

		it("should clean names ending with . or space", function() {
			clean("a ", "a_");
			clean("a.", "a_");
		});
	});

});
