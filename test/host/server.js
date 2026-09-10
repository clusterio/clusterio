"use strict";
const assert = require("assert").strict;
const dgram = require("dgram");
const events = require("events");
const fs = require("node:fs/promises");
const path = require("path");

const hostServer = require("@clusterio/host/dist/node/src/server");
const lib = require("@clusterio/lib");
const { wait } = lib;
const { testLines } = require("../lib/factorio/lines");
const { slowTest, externalTest } = require("../integration");


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
			it("should reject if the version does not match", async function() {
				let installDir = path.join("test", "file", "factorio", "0.1.1");
				await assert.rejects(
					hostServer._findVersion(installDir, "0.1.2"),
					new Error(
						`Unable to find Factorio version 0.1.2: ${installDir} is a direct (single-version) ` +
						`install of 0.1.1. Use a versioned layout, where ${installDir} contains a subdirectory ` +
						"per version, to run other versions or download them automatically."
					)
				);
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
			it("should reject if no factorio install was found", async function() {
				let installDir = path.join("test", "file");
				await assert.rejects(
					hostServer._findVersion(installDir, "0.0.0"),
					new Error(`Unable to find any Factorio install in ${installDir}`)
				);
			});
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

	describe("downloadAndExtractZip", function() {
		let _fetch;
		beforeEach(function() {
			_fetch = global.fetch;
		});
		afterEach(function() {
			global.fetch = _fetch;
		});

		it("works", async function() {
			slowTest(this);
			externalTest(this);
			const url = "https://github.com/clusterio/clusterio/archive/refs/tags/v2.0.0-alpha.22.zip";
			const downloads = path.join("temp", "test", "downloads");
			await fs.rm(downloads, { force: true, recursive: true, maxRetries: 10 });
			await fs.mkdir(downloads, { recursive: true });
			await hostServer._downloadAndExtractZip(url, path.join(downloads, "zip"));
			await fs.access(path.join(downloads, "zip", "packages", "controller", "package.json"));
		});
		it("errors and bad status", async function() {
			global.fetch = () => ({ ok: false, status: -1, statusText: "Fetch called" });
			await assert.rejects(hostServer._downloadAndExtractZip("url does not matter"), /-1 Fetch called/);
		});
	});

	describe("downloadAndExtractTar", function() {
		let _fetch;
		beforeEach(function() {
			_fetch = global.fetch;
		});
		afterEach(function() {
			global.fetch = _fetch;
		});

		it("works", async function() {
			slowTest(this);
			externalTest(this);
			const url = "https://github.com/clusterio/clusterio/archive/refs/tags/v2.0.0-alpha.22.tar.gz";
			const downloads = path.join("temp", "test", "downloads");
			await fs.rm(downloads, { force: true, recursive: true, maxRetries: 10 });
			await fs.mkdir(downloads, { recursive: true });
			await hostServer._downloadAndExtractTar(url, path.join(downloads, "tar"));
			await fs.access(path.join(downloads, "tar", "packages", "controller", "package.json"));
		});
		it("errors and bad status", async function() {
			global.fetch = () => ({ ok: false, status: -1, statusText: "Fetch called" });
			await assert.rejects(hostServer._downloadAndExtractTar("url does not matter"), /-1 Fetch called/);
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

		describe(".setTargetVersion()", function() {
			it("should override the target version before init", function() {
				const fresh = new hostServer.FactorioServer(
					path.join("test", "file", "factorio"), writePath, {}
				);
				fresh.setTargetVersion("0.1.5");
				assert.equal(fresh._targetVersion, "0.1.5");
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
				await fs.mkdir(server.writePath("script-output"), { recursive: true });
				let filePath = server.writePath("script-output", "data.json");
				await fs.writeFile(filePath, '{"data":"spam"}');
				let waiter = events.once(server, "ipc-channel");
				await server._handleIpc(Buffer.from("\f$ipc:channel?fdata.json"));
				let result = await waiter;
				assert.deepEqual(result[0], { "data": "spam" });
				await assert.rejects(fs.access(filePath), "File was not deleted");
			});
		});

		describe(".handle()", function() {
			it("should log validation errors from ipc handlers", async function() {
				let logged = [];
				let ipcServer = new hostServer.FactorioServer(
					path.join("test", "file", "factorio"), writePath,
					{ logger: { error: msg => { logged.push(msg); } } }
				);
				class NumberEvent {
					static type = "event";
					static src = "instance";
					static dst = "controller";
					constructor(value) { this.value = value; }
					static jsonSchema = { type: "number" };
					static fromJSON(json) { return new this(json); }
				}
				let eventFromJSON = lib.Link.eventFromJSON(NumberEvent, "NumberEvent");
				ipcServer.handle("bad_event", async () => { eventFromJSON("not a number"); });
				ipcServer.emit("ipc-bad_event", {});
				await new Promise(resolve => setImmediate(resolve));

				assert.equal(logged.length, 1);
				assert(logged[0].startsWith("Error handling ipc event:\nError: Event NumberEvent failed validation\n"));
				assert(logged[0].includes('"message": "must be number"'));
			});
		});

		describe("Lua UDP", function() {
			let udpServer;
			let received;
			before(async function() {
				// Stand-in for the Factorio server's --enable-lua-udp socket
				udpServer = dgram.createSocket("udp4");
				received = [];
				udpServer.on("message", (msg, rinfo) => received.push([msg, rinfo]));
				await events.once(udpServer.bind(0, "127.0.0.1"), "listening");
				server.luaUdpPort = udpServer.address().port;
			});
			after(function() {
				udpServer.close();
			});
			afterEach(function() {
				server._stopUdp();
				server._state = "init";
			});
			function sendFromGame(message) {
				udpServer.send(Buffer.from(message), server.hostUdpPort, "127.0.0.1");
			}
			function captureLogger(level) {
				const logger = server._logger;
				const lines = [];
				server._logger = { [level]: msg => lines.push(msg) };
				return { lines, restore: () => { server._logger = logger; } };
			}

			it("should not have a host port when not running", function() {
				assert.equal(server.hostUdpPort, undefined);
			});
			it("should reject sendUdp when the socket is not open", async function() {
				server._state = "running";
				await assert.rejects(server.sendUdp("data"), new Error("UDP socket is not open"));
			});
			it("should send packets to the Lua UDP port", async function() {
				await server._startUdp();
				server._state = "running";
				assert(server.hostUdpPort > 0, "hostUdpPort not set");

				await server.sendUdp("hello");
				await server.sendUdp(Buffer.from("world"));
				while (received.length < 2) {
					await wait(1);
				}
				assert.equal(received[0][0].toString(), "hello");
				assert.equal(received[1][0].toString(), "world");
				assert.equal(received[0][1].port, server.hostUdpPort);
			});
			it("should emit udp events for packets from the game", async function() {
				await server._startUdp();
				let udpReceived = [];
				let onUdp = data => udpReceived.push(data);
				// Escaped characters in the channel name are unescaped
				server.on("udp-udp?channel", onUdp);
				let waiter = events.once(server, "udp-udp?channel");
				// Packets not from the Factorio server's port are ignored
				let other = dgram.createSocket("udp4");
				try {
					await events.once(other.bind(0, "127.0.0.1"), "listening");
					other.send(Buffer.from("udp\\x3fchannel?bad"), server.hostUdpPort, "127.0.0.1");
					sendFromGame("udp\\x3fchannel?spam?eggs");
					await waiter;
				} finally {
					other.close();
					server.off("udp-udp?channel", onUdp);
				}
				assert(Buffer.isBuffer(udpReceived[0]), "data is not a Buffer");
				assert.deepEqual(udpReceived.map(String), ["spam?eggs"]);
			});
			it("should warn on malformed packets and unhandled channels", async function() {
				await server._startUdp();
				const { lines, restore } = captureLogger("warn");
				try {
					sendFromGame("no separator");
					sendFromGame("unhandled?data");
					while (lines.length < 2) {
						await wait(1);
					}
				} finally {
					restore();
				}
				assert.deepEqual(lines, [
					'Ignoring malformed UDP packet "no separator"',
					"Warning: Unhandled udp-unhandled",
				]);
			});
			it("should invoke handlers registered with handleUdp", async function() {
				let handled = [];
				server.handleUdp("handled", async data => { handled.push(data.toString()); });
				server.handleUdp("failing", async () => { throw new Error("boom"); });
				const { lines, restore } = captureLogger("error");
				try {
					server.emit("udp-handled", Buffer.from("data"));
					server.emit("udp-failing", Buffer.from("data"));
					await new Promise(resolve => setImmediate(resolve));
				} finally {
					restore();
				}
				assert.deepEqual(handled, ["data"]);
				assert.equal(lines.length, 1);
				assert(lines[0].startsWith("Error handling udp event:\nError: boom"), lines[0]);
			});
			it("should forward socket errors", async function() {
				await server._startUdp();
				let waiter = events.once(server, "error");
				server._udpSocket.emit("error", new Error("socket failed"));
				let [err] = await waiter;
				assert.equal(err.message, "socket failed");
			});
			it("should reject sendUdp when sending fails", async function() {
				await server._startUdp();
				server._state = "running";
				// Larger than the maximum size of a UDP datagram
				await assert.rejects(server.sendUdp(Buffer.alloc(70000)), { code: "EMSGSIZE" });
			});
			it("should throw if the socket is already open", async function() {
				await server._startUdp();
				await assert.rejects(server._startUdp(), new Error("UDP socket is already open"));
			});
			it("should log an error if opening the socket fails", async function() {
				const createSocket = dgram.createSocket;
				dgram.createSocket = (...args) => {
					const socket = createSocket(...args);
					socket.bind = () => process.nextTick(() => socket.emit("error", new Error("bind failed")));
					return socket;
				};
				const { lines, restore } = captureLogger("error");
				try {
					await server._startUdp();
				} finally {
					dgram.createSocket = createSocket;
					restore();
				}
				assert.equal(server._udpSocket, null);
				assert(lines[0].startsWith("Failed to open UDP socket:\nError: bind failed"), lines[0]);
			});
			it("should close the socket when the server exits", async function() {
				await server._startUdp();
				server._server = new events.EventEmitter();
				server._state = "stopping";
				server._watchExit();
				server._server.emit("exit", 0, null);
				assert.equal(server._udpSocket, null);
				assert.equal(server._state, "init");
			});
			it("should close the socket when the server is killed for hanging", async function() {
				await server._startUdp();
				let killed = false;
				server._server = { kill: () => { killed = true; } };
				const { restore } = captureLogger("error");
				try {
					server.onStopTimeout();
				} finally {
					restore();
					server._server = null;
				}
				assert(killed, "server was not killed");
				assert.equal(server._udpSocket, null);
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

		describe(".checkForUpdates()", function() {
			let _fetch;
			let fetchCalledWith;
			let _platform = process.platform;
			beforeEach(function() {
				_fetch = global.fetch;
				fetchCalledWith = null;
				global.fetch = async function(url) {
					fetchCalledWith = url;
					return {
						ok: false,
						status: -1,
						statusText: "Fetch called",
					};
				};
			});
			afterEach(function() {
				global.fetch = _fetch;
				server._factorioDir = path.join("test", "file", "factorio");
				Object.defineProperty(process, "platform", {
					value: _platform,
				});
			});

			for (const [suite, target] of [
				["full version", "0.1.1"],
				["partial version", "0.1"],
				["latest version", "latest"],
			]) {
				/* eslint-disable no-loop-func */
				describe(suite, function() {
					it("should do nothing when there are no versions", async function() {
						server._factorioDir = path.join("test", "file", "factorio");
						server._targetVersion = target;
						await server.checkForUpdates([]);

						assert.equal(fetchCalledWith, null);
					});
					if (target !== "latest") {
						it("should do nothing when no version matches", async function() {
							server._factorioDir = path.join("test", "file", "factorio");
							server._targetVersion = target;
							await server.checkForUpdates([{
								stable: true,
								version: "0.2.1",
								headlessUrl: "test1",
							}, {
								stable: false,
								version: "0.2.0",
								headlessUrl: "test2",
							}]);

							assert.equal(fetchCalledWith, null);
						});
					}
					it("should do nothing when there is no newer version", async function() {
						server._factorioDir = path.join("test", "file", "factorio");
						server._targetVersion = target;
						await server.checkForUpdates([{
							stable: true,
							version: "0.1.1",
							headlessUrl: "test1",
						}, {
							stable: false,
							version: "0.1.0",
							headlessUrl: "test2",
						}]);

						assert.equal(fetchCalledWith, null);
					});
					it("should do nothing for direct installs", async function() {
						server._factorioDir = path.join("test", "file", "factorio", "0.1.1");
						server._targetVersion = target === "0.1.1" ? "0.1.5" : target;
						await server.checkForUpdates([{
							stable: true,
							version: "0.1.5",
							headlessUrl: "test1",
						}, {
							stable: true,
							version: "0.1.1",
							headlessUrl: "test1",
						}, {
							stable: false,
							version: "0.1.0",
							headlessUrl: "test2",
						}]);

						assert.equal(fetchCalledWith, null);
					});
					it("should do nothing when on windows", async function() {
						let logLine = null;
						server._logger = { info: line => { logLine = line; } };
						Object.defineProperty(process, "platform", { value: "win32" });

						server._factorioDir = path.join("test", "file", "factorio");
						server._targetVersion = target === "0.1.1" ? "0.1.5" : target;
						await server.checkForUpdates([{
							stable: true,
							version: "0.1.5",
							headlessUrl: "test1",
						}, {
							stable: true,
							version: "0.1.1",
							headlessUrl: "test2",
						}, {
							stable: false,
							version: "0.1.0",
							headlessUrl: "test3",
						}]);

						assert.equal(fetchCalledWith, null);
						assert.ok(logLine !== null);
						assert.ok(logLine.endsWith("(automatic downloads are only supported on Linux)."));
					});
					it("should do attempt to download on linux", async function() {
						let logLine = null;
						server._logger = { info: line => { logLine = line; } };
						Object.defineProperty(process, "platform", { value: "linux" });

						server._factorioDir = path.join("test", "file", "factorio");
						server._targetVersion = target === "0.1.1" ? "0.1.5" : target;
						await assert.rejects(server.checkForUpdates([{
							stable: true,
							version: "0.1.5",
							headlessUrl: "test1",
						}, {
							stable: true,
							version: "0.1.1",
							headlessUrl: "test2",
						}, {
							stable: false,
							version: "0.1.0",
							headlessUrl: "test3",
						}]), new Error("Failed to fetch test1: -1 Fetch called"));

						assert.equal(fetchCalledWith, "test1");
						assert.ok(logLine !== null);
						assert.ok(logLine.endsWith("starting download..."));
					});
				});
				/* eslint-enable no-loop-func */
			}
			it("should download a version correctly (live api)", async function() {
				slowTest(this);
				externalTest(this);
				if (_platform !== "linux") {
					this.skip();
				}

				server._factorioDir = path.join("temp", "test", "factorioDownload");
				server._targetVersion = "latest";
				global.fetch = _fetch;
				await fs.rm(server._factorioDir, { force: true, recursive: true, maxRetries: 10 });
				await fs.mkdir(server._factorioDir, { recursive: true });
				await server.checkForUpdates([{
					stable: true,
					version: "2.0.73",
					headlessUrl: "https://www.factorio.com/get-download/2.0.73/headless/linux64",
				}]);
			});
		});
	});
});
