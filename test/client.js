const assert = require('assert').strict;
const path = require('path');
const fs = require('fs-extra');

const link = require("lib/link");
const client = require("../client");

describe("Client testing", function() {
	describe("class Instance", function() {
		let instance = new client._Instance(new link.VirtualConnector(), "dir", "factorioDir", { name:"foo" });
		describe(".name", function() {
			it("should give the name of the instance", function() {
				assert.equal(instance.name, "foo");
			})
		});

		describe(".path()", function() {
			it("should give the path when called without arguments", function() {
				assert.equal(instance.path(), "dir");
			})
			it("should join path with arguments", function() {
				assert.equal(instance.path("bar"), path.join("dir", "bar"));
			})
		});
	});

	describe("checkFilename()", function() {
		it("should allow a basic name", function() {
			client._checkFilename("file");
		});

		function check(item, msg) {
			assert.throws(() => client._checkFilename(item), new Error(msg));
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
			for (let bad of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1']) {
				check(
					bad, 'cannot be named any of . ..'
					+' CON PRN AUX NUL COM1-9 and LPT1-9'
				);
			}
		});

		it("should throw on . and ..", function() {
			for (let bad of ['.', '..']) {
				check(
					bad, 'cannot be named any of . ..'
					+' CON PRN AUX NUL COM1-9 and LPT1-9'
				);
			}
		});

		it("should throw on names ending with . or space", function() {
			check("a ", "cannot end with . or space");
			check("a.", "cannot end with . or space");
		});
	});

	describe("symlinkMods()", function() {
		// Remove previous test output
		let testDir = path.join("test", "temp", "symlink");
		fs.removeSync(testDir);

		// Add some test mods
		fs.outputFileSync(path.join(testDir, "shared", "mod_a.zip"), "a");
		fs.outputFileSync(path.join(testDir, "shared", "mod_b.zip"), "b");
		fs.outputFileSync(path.join(testDir, "shared", "mod.dat"), "c");
		let instance = new client._Instance(
			new link.VirtualConnector(), path.join(testDir, "instance"), "factorioDir", { name: "test" }
		);
		fs.outputFileSync(instance.path("mods", "mod_i.zip"), "i");

		let discardingLogger = {
			warning: function() { },
			log: function() { },
		}

		it("should link mods and data files", async function() {
			await client._symlinkMods(instance, path.join(testDir, "shared"), discardingLogger);

			assert.equal(await fs.readFile(instance.path("mods", "mod_a.zip"), "utf-8"), "a");
			assert.equal(await fs.readFile(instance.path("mods", "mod_b.zip"), "utf-8"), "b");
			assert.equal(await fs.readFile(instance.path("mods", "mod.dat"), "utf-8"), "c");
			assert.equal(await fs.readFile(instance.path("mods", "mod_i.zip"), "utf-8"), "i");
		});

		it("should ignore directories", async function() {
			await fs.ensureDir(path.join(testDir, "shared", "dir"));
			await client._symlinkMods(instance, path.join(testDir, "shared"), discardingLogger);

			assert(!await fs.exists(instance.path("mods", "dir"), "utf-8"), "dir was unxpectedly linked");
		});

		it("should ignore files", async function() {
			await fs.outputFile(path.join(testDir, "shared", "file"), "f");
			await client._symlinkMods(instance, path.join(testDir, "shared"), discardingLogger);

			assert(!await fs.exists(instance.path("mods", "file"), "utf-8"), "dir was unxpectedly linked");
		});

		it("should unlink removed mods", async function() {
			// This does not work on Windows
			if (process.platform == "win32") {
				this.skip();
			}

			await fs.unlink(path.join(testDir, "shared", "mod_a.zip"));
			await client._symlinkMods(instance, path.join(testDir, "shared"), discardingLogger);

			await assert.rejects(fs.lstat(instance.path("mods", "mod_a.zip")), { code: "ENOENT" });
			assert.equal(await fs.readFile(instance.path("mods", "mod_b.zip"), "utf-8"), "b");
			assert.equal(await fs.readFile(instance.path("mods", "mod.dat"), "utf-8"), "c");
			assert.equal(await fs.readFile(instance.path("mods", "mod_i.zip"), "utf-8"), "i");
		});
	});

	describe("discoverInstances()", function() {
		it("should discover test instance", async function() {
			let logger = { log: () => {}, error: () => {} };
			let instancePath = path.join("test", "file", "instances");
			let instanceInfos = await client._discoverInstances(instancePath, logger);
			assert.deepEqual(instanceInfos, new Map([
				[1, {
					config: {
						id: 1,
						name: "test",
						factorioPort: null,
						clientPort: null,
						clientPassword: null
					},
					path: path.join(instancePath, "test"),
				}],
			]));
		});
	});
});
