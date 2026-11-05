import assert from "node:assert/strict";
import childProcess from "node:child_process";
import dgram from "node:dgram";
import events from "node:events";
import path from "node:path";

import * as lib from "@clusterio/lib";
import { FactorioServer } from "@clusterio/host/dist/node/src/server.js";
import "../setup_logging.js";

class FakeProcess extends events.EventEmitter {
	stdout = { pipe() {} };
	stderr = { pipe() {} };
	kill() {}
}

function argValue(args, flag) {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : Number(args[index + 1]);
}

describe("host/src/server ports", function() {
	let spawn;
	let spawned;
	let servers;
	beforeEach(function() {
		spawn = childProcess.spawn;
		spawned = [];
		childProcess.spawn = (command, args) => {
			const process = new FakeProcess();
			spawned.push({ args, process });
			return process;
		};
		servers = [];
	});
	afterEach(function() {
		childProcess.spawn = spawn;
		for (const server of servers) {
			server._stopUdp();
			if (server._server) {
				server._state = "stopping";
				server._server.emit("exit", 0, null);
			}
		}
	});

	function makeServer(options = {}) {
		const server = new FactorioServer(
			path.join("test", "file", "factorio"), path.join("temp", "test", "server_ports"),
			path.join("test", "file", "factorio", "0.1.2", "data"), "2.1.10",
			{ rconPassword: "", gamePort: 34197, rconPort: 34198, ...options },
		);
		server.binaryPath = () => "factorio";
		// eslint-disable-next-line node/no-sync
		server._writeConfigIniSync = () => {};
		// eslint-disable-next-line node/no-sync
		server._writeMapSettingsSync = () => {};
		server._watchWhitelist = () => {};
		server._waitForReady = async () => {};
		servers.push(server);
		return server;
	}

	for (const method of ["start", "startScenario"]) {
		// eslint-disable-next-line no-loop-func
		describe(`.${method}()`, function() {
			it("passes the given ports to Factorio", async function() {
				const server = makeServer({ enableLuaUdp: true, luaUdpPort: 40000, hostUdpPort: 40001 });
				await server[method]("save");
				const { args } = spawned[0];
				assert.equal(argValue(args, "--port"), 34197);
				assert.equal(argValue(args, "--rcon-port"), 34198);
				assert.equal(argValue(args, "--enable-lua-udp"), 40000);
			});
			it("does not need Lua UDP ports when Lua UDP is disabled", async function() {
				await makeServer()[method]("save");
				assert.equal(argValue(spawned[0].args, "--enable-lua-udp"), undefined);
			});
			const missingPorts = [
				["gamePort", { gamePort: undefined }],
				["gamePort", { gamePort: 0 }],
				["rconPort", { rconPort: undefined }],
				["rconPort", { rconPort: 0 }],
				["luaUdpPort", { enableLuaUdp: true, hostUdpPort: 40001 }],
				["hostUdpPort", { enableLuaUdp: true, luaUdpPort: 40000 }],
			];
			missingPorts.forEach(([name, options]) => {
				it(`refuses to start with ${name} ${JSON.stringify(options[name])}`, async function() {
					const server = makeServer(options);
					await assert.rejects(server[method]("save"), new RegExp(`${name} must be set to a port`));
					assert.equal(server._state, "init");
					assert.equal(spawned.length, 0);
				});
			});
		});
	}

	describe("._startUdp()", function() {
		let held;
		beforeEach(async function() {
			held = dgram.createSocket("udp4");
			await events.once(held.bind(0, "127.0.0.1"), "listening");
		});
		afterEach(function() {
			held.close();
		});

		it("binds the given host UDP port", async function() {
			const port = held.address().port;
			held.close();
			held = dgram.createSocket("udp4");
			const server = makeServer({ enableLuaUdp: true, luaUdpPort: 40000, hostUdpPort: port });
			await server._startUdp();
			assert.equal(server.hostUdpPort, port);
			server._stopUdp();
			assert.equal(server.hostUdpPort, undefined);
		});
		it("raises an error if the host UDP port is taken", async function() {
			const port = held.address().port;
			const server = makeServer({ enableLuaUdp: true, luaUdpPort: 40000, hostUdpPort: port });
			await assert.rejects(
				server._startUdp(),
				err => err instanceof lib.EnvironmentError
					&& err.message.startsWith(`Failed to bind host Lua UDP socket to port ${port}:`),
			);
			assert.equal(server._udpSocket, null);
		});
	});
});
