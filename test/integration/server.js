const assert = require("assert").strict;
const events = require("events");
const fs = require("fs-extra");
const path = require("path");

const factorio = require("lib/factorio");
const errors = require("lib/errors");

const { slowTest } = require("./index");


describe("Integration of lib/factorio/server", function() {
	describe("_getVersion()", function() {
		it("should get a version from factorio's changelog.txt", async function() {
			let version = await factorio._getVersion(path.join("factorio", "data", "changelog.txt"));
			if (!/^\d+\.\d+\.\d+$/.test(version)) {
				assert.fail(`Detected version '${version}' does not followed the format x.y.z`);
			}
		});
	});

	describe("class FactorioServer", function() {
		let writePath = path.join("temp", "test", "integration");
		let server = new factorio.FactorioServer("factorio", writePath, {});
		let logFile;

		before(async function() {
			// Delete result from previous run of these tests
			if (fs.existsSync(writePath)) {
				await fs.remove(writePath);
			}

			await fs.ensureDir(writePath);
			logFile = fs.createWriteStream(path.join(writePath, "log.txt"), "utf8");
			server.on('output', function(output) {
				logFile.write(JSON.stringify(output) + "\n");
			});

			// Initialize sever.
			await server.init();
		});

		after(function() {
			logFile.end();
		});

		describe(".exampleSettings()", function() {
			let settings;
			it("returns an object", async function() {
				settings = await server.exampleSettings();
				assert(typeof settings === "object");
			});

			it("contains the settings used by Clusterio", async function() {
				let keysUsed = new Set([
					"name", "description", "tags", "visibility", "username", "token",
					"game_password", "require_user_verification", "allow_commands",
					"auto_pause",
				]);

				for (let key of Object.keys(settings)) {
					keysUsed.delete(key);
				}

				assert(
					keysUsed.size === 0,
					`Factorio's server-settings.example.json does not contain the key(s) ${[...keysUsed]}`
				);
			});
		});

		function log(message) {
			logFile.write("=================== " + message + "\n");
		}

		describe(".create()", function() {
			it("creates a map file at writeDir/saves/name", async function() {
				slowTest(this);
				log(".create() with new save");

				// Make sure the test is not fooled by previous data
				let mapPath = server.writePath("saves", "test.zip");
				assert(!await fs.exists(mapPath), "save exist before test");

				await server.create("test.zip");
				assert(await fs.exists(mapPath), "test did not create save");
			});
		});

		describe(".start()", function() {
			it("starts the server", async function() {
				slowTest(this);
				log(".start()");

				// Make sure the test does not fail due to create() failing.
				let mapPath = server.writePath("saves", "test.zip");
				assert(await fs.exists(mapPath), "save is missing");

				await server.start("test.zip");
			});
		});

		describe(".disableAchievments()", function() {
			it("disables acheivements", async function() {
				slowTest(this);
				log(".disableAchievements()");
				assert.equal(await server.disableAchievements(), true);
			});

			it("can tell when acheivements were disabled", async function() {
				slowTest(this);
				assert.equal(await server.disableAchievements(), false);
			});
		});

		describe(".sendRcon()", function() {
			it("returns the result of a command", async function() {
				slowTest(this);
				log(".sendRcon()");

				let result = await server.sendRcon("/sc rcon.print('success')");
				assert.equal(result, 'success\n');
			});
			it("throws on non-empty response when enabled", async function() {
				slowTest(this);
				await assert.rejects(
					server.sendRcon("/sc rcon.print('fail')", true),
					new Error('Expected empty response but got "fail\n"')
				);
			});
		});

		describe(".stop()", function() {
			it("stops the server", async function() {
				slowTest(this);
				log(".stop()");

				await server.stop();
			});
		});

		describe(".startScenario()", function() {
			before("Write test_scenario", async function() {
				let content = "script.on_init(function() print('test_scenario init') end)\n";
				await fs.outputFile(server.writePath("scenarios", "test_scenario", "control.lua"), content);
			});

			it("runs the given scenario", async function() {
				slowTest(this);
				log(".startScenario()");

				let pass = false
				function filter(output) {
					if (output.message === "test_scenario init") {
						pass = true;
					}
				}
				server.on('output', filter);

				await server.startScenario("test_scenario");

				log(".stop()");
				await server.stop();

				server.off('output', filter);
				assert(pass, "server did not output line from test scenario");
			});
		});

		describe(".start() error handling", function() {
			it("should handle factorio erroring out", async function() {
				slowTest(this);
				log(".start() for error handling");

				await server.start("test.zip");
				if (!server._rconReady) {
					await events.once(server, "rcon-ready");
				}
				server.sendRcon("/c script.on_nth_tick(1, function() o.o = 1 end)").catch(() => {});

				function discard() { }
				server.on("error", discard);
				await new Promise(resolve => server.once("exit", resolve));
				server.off("error", discard);
			});
		});
		describe(".stop() hang detection", function() {
			it("should detect factorio hanging on shutdown", async function() {
				slowTest(this);
				log(".start() for hang detection");

				await server.start("test.zip");
				if (!server._rconReady) {
					await events.once(server, 'rcon-ready');
				}
				server.sendRcon("/c while true do end").catch(() => {});
				await new Promise((resolve) => setTimeout(resolve, 300));
				log(".stop() for hang detection");
				await server.stop();
			});
		});

		describe(".start() termination detection", function() {
			it("should tell if Factorio got killed", async function() {
				// This does not work on Windows
				if (process.platform == "win32") {
					this.skip();
				}
				slowTest(this);
				log(".start() for kill detection");

				let startPromise = server.start("test.zip");
				server.once('output', () => server._server.kill('SIGKILL'));

				await assert.rejects(
					startPromise,
					new errors.EnvironmentError("Factorio server was unexpectedly killed, is the system low on memory?")
				);
			});

			it("should tell if Factorio unexpectedly closed with a code", async function() {
				slowTest(this);
				log(".start() for unexpected close detection");

				await assert.rejects(
					server.start("does-not-exist.zip"),
					new errors.EnvironmentError("Factorio server unexpectedly shut down with code 1")
				);
			});
		});
	});
});
