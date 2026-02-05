"use strict";
const assert = require("assert").strict;
const events = require("events");
const fs = require("fs-extra");
const path = require("path");

const hostServer = require("@clusterio/host/dist/node/src/server");
const lib = require("@clusterio/lib");
const { wait } = lib;
const { testLines } = require("../lib/factorio/lines");


describe("host/server", function() {
	describe("_getFactorioVersion()", function() {
		it("should get the version from a changelog", async function() {
			let version = await hostServer._getFactorioVersion(path.join("test", "file", "changelogs", "good"));
			assert.equal(version, "0.1.1");
		});
		it("should return null if unable to find the version", async function() {
			let version = await hostServer._getFactorioVersion(path.join("test", "file", "changelogs", "bad"));
			assert.equal(version, null);
		});
		it("should return null if file does not exist", async function() {
			let version = await hostServer._getFactorioVersion(path.join("test", "file", "changelogs", "not-exists"));
			assert.equal(version, null);
		});
	});

	describe("_versionOrder()", function() {
		it("should sort an array of versions", function() {
			let versions = ["1.2.3", "0.1.4", "0.1.2", "1.2.3", "0.1.5", "1.10.2"];
			versions.sort(hostServer._versionOrder);
			assert.deepEqual(
				versions,
				["1.10.2", "1.2.3", "1.2.3", "0.1.5", "0.1.4", "0.1.2"]
			);
		});
	});

	describe("_findVersion()", function() {
		describe("direct install", function() {
			it("should search given directory for latest Factorio install", async function() {
				const installDir = path.join("test", "file", "factorio", "0.1.2");
				const [dir, version] = await hostServer._findVersion(installDir, "latest");
				assert.equal(dir, path.join(installDir, "data"));
				assert.equal(version, "0.1.2");
			});
			it("should search given directory for given Factorio install", async function() {
				const installDir = path.join("test", "file", "factorio", "0.1.1");
				const [dir, version] = await hostServer._findVersion(installDir, "0.1.1");
				assert.equal(dir, path.join(installDir, "data"));
				assert.equal(version, "0.1.1");
			});
			it("should search given directory for partly given Factorio install", async function() {
				const installDir = path.join("test", "file", "factorio", "0.1.2");
				const [dir, version] = await hostServer._findVersion(installDir, "0.1");
				assert.equal(dir, path.join(installDir, "data"));
				assert.equal(version, "0.1.2");
			});
			it("should search given directory for latest Factorio install", async function() {
				const installDir = path.join("test", "file", "factorio");
				const [dir, version] = await hostServer._findVersion(installDir, "latest");
				assert.equal(dir, path.join(installDir, "0.1.2", "data"));
				assert.equal(version, "0.1.2");
			});
		});
		describe("mutli install", function() {
			it("should reject if no factorio install with the given version was found", async function() {
				let installDir = path.join("test", "file", "factorio");
				await assert.rejects(
					hostServer._findVersion(installDir, "0.1.3"),
					new Error("Unable to find Factorio version 0.1.3")
				);
			});
			it("should search given directory for given Factorio install", async function() {
				const installDir = path.join("test", "file", "factorio");
				const [dir, version] = await hostServer._findVersion(installDir, "0.1.1");
				assert.equal(dir, path.join(installDir, "0.1.1", "data"));
				assert.equal(version, "0.1.1");
			});
			it("should search given directory for partly given Factorio install", async function() {
				const installDir = path.join("test", "file", "factorio");
				const [dir, version] = await hostServer._findVersion(installDir, "0.1");
				assert.equal(dir, path.join(installDir, "0.1.2", "data"));
				assert.equal(version, "0.1.2");
			});
			it("should reject if no factorio install with the given version was found", async function() {
				let installDir = path.join("test", "file", "factorio");
				await assert.rejects(
					hostServer._findVersion(installDir, "0.1.3"),
					new Error("Unable to find Factorio version 0.1.3")
				);
			});
		});
		it("should reject if no factorio install was found", async function() {
			let installDir = path.join("test", "file");
			await assert.rejects(
				hostServer._findVersion(installDir, "latest"),
				new Error(`Unable to find any Factorio install in ${installDir}`)
			);
		});
	});

	describe("_listFactorioVersions()", function() {
		it("should list the version in a direct install", async function() {
			const installDir = path.join("test", "file", "factorio", "0.1.1");
			const installedVersions = await hostServer._listFactorioVersions(installDir);
			assert.deepEqual(installedVersions, {
				direct: true,
				versions: new Set(["0.1.1"]),
			});
		});
		it("should list all versions in a directory", async function() {
			const installDir = path.join("test", "file", "factorio");
			const installedVersions = await hostServer._listFactorioVersions(installDir);
			assert.deepEqual(installedVersions, {
				direct: false,
				versions: new Set(["0.1.1", "0.1.2"]),
			});
		});
	});

	describe("randomDynamicPort()", function() {
		it("should return a port number", function() {
			let port = hostServer._randomDynamicPort();
			assert.equal(typeof port, "number");
			assert(Number.isInteger(port));
			assert(0 <= port && port < 2**16);
		});

		it("should return a port number in the dynamic range", function() {
			function validate(port) {
				return (49152 <= port && port <= 65535);
			}
			for (let i=0; i < 20; i++) {
				assert(validate(hostServer._randomDynamicPort()));
			}
		});
	});

	describe("generatePassword()", function() {
		it("should return a string", async function() {
			let password = await hostServer._generatePassword(1);
			assert.equal(typeof password, "string");
		});

		it("should return a string of the given length", async function() {
			let password = await hostServer._generatePassword(10);
			assert.equal(password.length, 10);
		});

		it("should contain only a-z, A-Z, 0-9", async function() {
			let password = await hostServer._generatePassword(10);
			assert(/^[a-zA-Z0-9]+$/.test(password), `${password} failed test`);
		});
	});

	describe("parseOutput()", function() {
		it("should parse the test lines", function() {
			for (let [line, reference] of testLines) {
				reference.source = "test";
				let output = hostServer._parseOutput(line, "test");
				assert.deepEqual(output, reference);
			}
		});
	});

	describe("class FactorioServer", function() {
		let writePath = path.join("temp", "test", "server");
		let server = new hostServer.FactorioServer(path.join("test", "file", "factorio"), writePath, {});

		describe("constructor()", function() {
			it("should handle dashes in write path with strapPaths enabled", function() {
				// eslint-disable-next-line no-new
				new hostServer.FactorioServer(
					path.join("test", "file", "factorio"),
					path.join("temp", "test", "server-1"),
					{ stripPaths: true }
				);
			});
		});

		describe(".init()", function() {
			it("should not throw on first call", async function() {
				await server.init();
			});

			it("should throw if called twice", async function() {
				await assert.rejects(server.init(), new Error("Expected state new but state is init"));
			});
		});

		describe(".version", function() {
			it("should return the version detected", function() {
				assert.equal(server.version, "0.1.2");
			});
		});

		describe("._handleIpc()", function() {
			it("should emit the correct ipc event", async function() {
				let waiter = events.once(server, "ipc-channel");
				await server._handleIpc(Buffer.from('\f$ipc:channel?j"value"'));
				let result = await waiter;
				assert.equal(result[0], "value");
			});
			it("should handle special characters in channel name", async function() {
				let waiter = events.once(server, "ipc-$ ?\x00\x0a:");
				await server._handleIpc(Buffer.from('\f$ipc:$ \\x3f\\x00\\x0a:?j"value"'));
				let result = await waiter;
				assert.equal(result[0], "value");
			});
			it("should throw on malformed ipc line", async function() {
				await assert.rejects(
					server._handleIpc(Buffer.from("\f$ipc:blah")),
					new Error('Malformed IPC line "\f$ipc:blah"')
				);
			});
			it("should throw on unknown type", async function() {
				await assert.rejects(
					server._handleIpc(Buffer.from("\f$ipc:channel??")),
					new Error("Unknown IPC type '?'")
				);
			});
			it("should throw on unknown file type", async function() {
				await assert.rejects(
					server._handleIpc(Buffer.from("\f$ipc:channel?ffoo.invalid")),
					new Error("Unknown IPC file format 'invalid'")
				);
			});
			it("should throw on file name with slash", async function() {
				await assert.rejects(
					server._handleIpc(Buffer.from("\f$ipc:channel?fa/b")),
					new Error("Invalid IPC file name 'a/b'")
				);
			});
			it("should load and delete json file", async function() {
				let filePath = server.writePath("script-output", "data.json");
				await fs.outputFile(filePath, '{"data":"spam"}');
				let waiter = events.once(server, "ipc-channel");
				await server._handleIpc(Buffer.from("\f$ipc:channel?fdata.json"));
				let result = await waiter;
				assert.deepEqual(result[0], { "data": "spam" });
				assert(!await fs.pathExists(filePath), "File was not deleted");
			});
		});

		describe(".stop()", function() {
			it("should handle server quitting on its own during stop", async function() {
				server.shutdownTimeoutMs = 20;
				server._server = new events.EventEmitter();
				server._server.kill = () => true;
				server._state = "running";
				server._rconReady = false;
				server._rconClient = {
					async sendRcon() { },
					async end() {
						server._rconClient = null;
					},
				};
				server._watchExit();

				const stop = server.stop();
				stop.catch(() => {});
				process.nextTick(() => {
					server.emit("rcon-ready");
					server._server.emit("exit");
				});

				await stop;
				await wait(21); // Wait until after shutdown timeout
			});
		});
	});
});
