const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const factorio = require("lib/factorio");


describe("lib/factorio/server", function() {
	describe("_getVersion()", function() {
		it("should get the version from a changelog", async function() {
			let version = await factorio._getVersion(path.join("test", "file", "changelog-test.txt"));
			assert.equal(version, "0.1.1");
		});
		it("should throw if unable to find the version", async function() {
			await assert.rejects(
				factorio._getVersion(path.join("test", "file", "changelog-bad.txt")),
				new Error("Unable to determine the version of Factorio")
			);
		});
	});

	describe("randomDynamicPort()", function() {
		it("should return a port number", function() {
			let port = factorio._randomDynamicPort()
			assert.equal(typeof port, "number");
			assert(Number.isInteger(port));
			assert(0 <= port && port < 2**16);
		});

		it("should return a port number in the dynamic range", function() {
			function validate(port) {
				return 49152 <= port && port <= 65535;
			}
			for (let i=0; i < 20; i++) {
				assert(validate(factorio._randomDynamicPort()));
			}
		});
	});

	describe("generatePassword()", function() {
		it("should return a string", async function() {
			let password = await factorio._generatePassword(1);
			assert.equal(typeof password, "string");
		});

		it("should return a string of the given length", async function() {
			let password = await factorio._generatePassword(10);
			assert.equal(password.length, 10);
		});

		it("should contain only a-z, A-Z, 0-9", async function() {
			let password = await factorio._generatePassword(10);
			assert(/^[a-zA-Z0-9]+$/.test(password), `${password} failed test`);
		});
	});

	describe("class LineSplitter", function() {
		function createSplitter(lines) {
			return new factorio._LineSplitter(line => lines.push(line.toString("utf-8")));
		}

		it("should split three lines", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.data(Buffer.from("line 1\nline 2\nline 3\n"));
			ls.end();
			assert.deepEqual(lines, ["line 1", "line 2", "line 3"]);
		});
		it("should split three Windows line endings lines", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.data(Buffer.from("line 1\r\nline 2\r\nline 3\r\n"));
			assert.deepEqual(lines, ["line 1", "line 2", "line 3"]);
		});
		it("should give the last non-terminated line on .end()", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.data(Buffer.from("line a\nline b"));
			assert.deepEqual(lines, ["line a"]);
			ls.end();
			assert.deepEqual(lines, ["line a", "line b"]);
		});
		it("should handled partial lines", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.data(Buffer.from("part 1"));
			ls.data(Buffer.from(" part 2 "));
			ls.data(Buffer.from("part 3\n"));
			ls.end();
			assert.deepEqual(lines, ["part 1 part 2 part 3"]);
		});
	});

	describe("parseOutput()", function() {
		let testLines = new Map([
			[
				"   1.306 Info RemoteCommandProcessor.cpp:131: Starting RCON interface at port 4000",
				{
					format: 'seconds',
					time: '1.306',
					type: 'log',
					level: 'Info',
					file: "RemoteCommandProcessor.cpp:131",
					message: "Starting RCON interface at port 4000",
				}
			],
			[
				" 640.910 Quitting: remote-quit.",
				{
					format: 'seconds',
					time: '640.910',
					type: 'generic',
					message: "Quitting: remote-quit.",
				}
			],
			[
				"1641.421 Goodbye",
				{
					format: 'seconds',
					time: '1641.421',
					type: 'generic',
					message: "Goodbye",
				}
			],
			[
				"2019-01-20 10:30:04 [JOIN] User joined the game",
				{
					format: 'date',
					time: '2019-01-20 10:30:04',
					type: 'action',
					action: "JOIN",
					message: "User joined the game",
				}
			],
			[
				"2019-01-20 10:30:07 [CHAT] User: chat message",
				{
					format: 'date',
					time: '2019-01-20 10:30:07',
					type: 'action',
					action: "CHAT",
					message: "User: chat message",
				}
			],
			[
				"2019-01-20 10:30:14 [COMMAND] User (command): blah",
				{
					format: 'date',
					time: '2019-01-20 10:30:14',
					type: 'action',
					action: "COMMAND",
					message: "User (command): blah",
				}
			],
			[
				"2019-01-20 10:30:14 Cannot execute command. Error: [string \"blah\"]:1: syntax error near <eof>",
				{
					format: 'date',
					time: '2019-01-20 10:30:14',
					type: 'generic',
					message: "Cannot execute command. Error: [string \"blah\"]:1: syntax error near <eof>",
				}
			],
			[
				"2019-01-20 10:30:21 [LEAVE] User left the game",
				{
					format: 'date',
					time: '2019-01-20 10:30:21',
					type: 'action',
					action: "LEAVE",
					message: "User left the game",
				}
			],
			[
				"Error while running event level::on_nth_tick(1)",
				{
					format: 'none',
					type: 'generic',
					message: "Error while running event level::on_nth_tick(1)",
				}
			],
		])

		it("should parse the test lines", function() {
			for (let [line, reference] of testLines) {
				reference.source = 'test';
				let output = factorio._parseOutput(line, 'test');
				delete output.received;
				assert.deepEqual(output, reference);
			}
		});
	});

	describe("class FactorioServer", function() {
		let writePath = path.join("test", "temp", "should_not_exist");
		let server = new factorio.FactorioServer(path.join("test", "file", "factorio", "data"), writePath, {});

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
				assert.equal(server.version, "0.1.1");
			});
		});
	});
});
