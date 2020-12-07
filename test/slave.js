"use strict";
const assert = require("assert").strict;
const path = require("path");
const fs = require("fs-extra");

const libLink = require("@clusterio/lib/link");
const libConfig = require("@clusterio/lib/config");
const slave = require("@clusterio/slave/slave");

describe("Slave testing", function() {
	before(function() {
		libConfig.InstanceConfig.finalize();
	});

	describe("class Instance", function() {
		let instance;
		before(async function() {
			let instanceConfig = new libConfig.InstanceConfig();
			await instanceConfig.init();
			instanceConfig.set("instance.name", "foo");
			instance = new slave._Instance({}, new libLink.VirtualConnector(), "dir", "factorioDir", instanceConfig);
		});

		describe(".name", function() {
			it("should give the name of the instance", function() {
				assert.equal(instance.name, "foo");
			});
		});

		describe(".path()", function() {
			it("should give the path when called without arguments", function() {
				assert.equal(instance.path(), "dir");
			});
			it("should join path with arguments", function() {
				assert.equal(instance.path("bar"), path.join("dir", "bar"));
			});
		});
	});

	describe("checkFilename()", function() {
		it("should allow a basic name", function() {
			slave._checkFilename("file");
		});

		function check(item, msg) {
			assert.throws(() => slave._checkFilename(item), new Error(msg));
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
				check(bad, "cannot be named any of . .. CON PRN AUX NUL COM1-9 and LPT1-9");
			}
		});

		it("should throw on . and ..", function() {
			for (let bad of [".", ".."]) {
				check(bad, "cannot be named any of . .. CON PRN AUX NUL COM1-9 and LPT1-9");
			}
		});

		it("should throw on names ending with . or space", function() {
			check("a ", "cannot end with . or space");
			check("a.", "cannot end with . or space");
		});
	});

	describe("symlinkMods()", function() {
		let testDir = path.join("temp", "test", "symlink");

		let instance;
		before(async function() {
			// Remove previous test output
			await fs.remove(testDir);

			// Add some test mods
			await fs.outputFile(path.join(testDir, "shared", "mod_a.zip"), "a");
			await fs.outputFile(path.join(testDir, "shared", "mod_b.zip"), "b");
			await fs.outputFile(path.join(testDir, "shared", "mod.dat"), "c");

			let instanceConfig = new libConfig.InstanceConfig();
			await instanceConfig.init();
			instanceConfig.set("instance.name", "test");
			instance = new slave._Instance(
				{}, new libLink.VirtualConnector(), path.join(testDir, "instance"), "factorioDir", instanceConfig
			);
			await fs.outputFile(instance.path("mods", "mod_i.zip"), "i");
		});

		it("should link mods and data files", async function() {
			await slave._symlinkMods(instance, path.join(testDir, "shared"));

			assert.equal(await fs.readFile(instance.path("mods", "mod_a.zip"), "utf-8"), "a");
			assert.equal(await fs.readFile(instance.path("mods", "mod_b.zip"), "utf-8"), "b");
			assert.equal(await fs.readFile(instance.path("mods", "mod.dat"), "utf-8"), "c");
			assert.equal(await fs.readFile(instance.path("mods", "mod_i.zip"), "utf-8"), "i");
		});

		it("should ignore directories", async function() {
			await fs.ensureDir(path.join(testDir, "shared", "dir"));
			await slave._symlinkMods(instance, path.join(testDir, "shared"));

			assert(!await fs.exists(instance.path("mods", "dir"), "utf-8"), "dir was unxpectedly linked");
		});

		it("should ignore files", async function() {
			await fs.outputFile(path.join(testDir, "shared", "file"), "f");
			await slave._symlinkMods(instance, path.join(testDir, "shared"));

			assert(!await fs.exists(instance.path("mods", "file"), "utf-8"), "dir was unxpectedly linked");
		});

		it("should unlink removed mods", async function() {
			// This does not work on Windows
			if (process.platform === "win32") {
				this.skip();
			}

			await fs.unlink(path.join(testDir, "shared", "mod_a.zip"));
			await slave._symlinkMods(instance, path.join(testDir, "shared"));

			await assert.rejects(fs.lstat(instance.path("mods", "mod_a.zip")), { code: "ENOENT" });
			assert.equal(await fs.readFile(instance.path("mods", "mod_b.zip"), "utf-8"), "b");
			assert.equal(await fs.readFile(instance.path("mods", "mod.dat"), "utf-8"), "c");
			assert.equal(await fs.readFile(instance.path("mods", "mod_i.zip"), "utf-8"), "i");
		});
	});

	describe("discoverInstances()", function() {
		it("should discover test instance", async function() {
			let instancePath = path.join("test", "file", "instances");
			let instanceInfos = await slave._discoverInstances(instancePath);

			let referenceConfig = new libConfig.InstanceConfig();
			await referenceConfig.init();
			referenceConfig.set("instance.id", 1);
			referenceConfig.set("instance.name", "test");

			assert.deepEqual(instanceInfos, new Map([
				[1, {
					config: referenceConfig,
					path: path.join(instancePath, "test"),
				}],
			]));
		});
	});

	describe("class Slave", function() {
		describe(".syncUserListsEventHandler()", function() {
			let mockSlave;
			beforeEach(function() {
				mockSlave = {
					adminlist: new Set(),
					whitelist: new Set(),
					banlist: new Map(),
					broadcasts: [],
					broadcastEventToInstance(message, event) {
						this.broadcasts.push(message["data"]);
					},
					syncUserListsEventHandler: slave._Slave.prototype.syncUserListsEventHandler,
					syncLists(adminlist, banlist, whitelist) {
						return this.syncUserListsEventHandler({ "data": {
							"adminlist": adminlist,
							"banlist": banlist,
							"whitelist": whitelist,
						}});
					},
				};
			});

			it("should broadcast new entries to adminlist", async function() {
				await mockSlave.syncLists(["admin1"], [], []);
				await mockSlave.syncLists(["admin1", "admin2"], [], []);

				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "admin1", "admin": true },
					{ "name": "admin2", "admin": true },
				]);
			});

			it("should broadcast removals from adminlist", async function() {
				mockSlave.adminlist.add("admin1").add("admin2");
				await mockSlave.syncLists(["admin1"], [], []);
				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "admin2", "admin": false },
				]);
			});

			it("should broadcast new entries to whitelist", async function() {
				await mockSlave.syncLists([], [], ["player1"]);
				await mockSlave.syncLists([], [], ["player1", "player2"]);

				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "player1", "whitelisted": true },
					{ "name": "player2", "whitelisted": true },
				]);
			});

			it("should broadcast removals from whitelist", async function() {
				mockSlave.whitelist.add("player1").add("player2");
				await mockSlave.syncLists([], [], ["player1"]);

				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "player2", "whitelisted": false },
				]);
			});

			it("should broadcast new entries to banlist", async function() {
				await mockSlave.syncLists([], [["badie1", "greifing"]], []);
				await mockSlave.syncLists([], [["badie1", "greifing"], ["badie2", "annoying"]], []);

				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "badie1", "banned": true, "reason": "greifing" },
					{ "name": "badie2", "banned": true, "reason": "annoying" },
				]);
			});

			it("should broadcast removals to banlist", async function() {
				mockSlave.banlist.set("badie1", "greifing").set("badie2", "annoying");
				await mockSlave.syncLists([], [["badie1", "greifing"]], []);

				assert.deepEqual(mockSlave.broadcasts, [
					{ "name": "badie2", "banned": false, "reason": "" },
				]);
			});
		});
	});
});
