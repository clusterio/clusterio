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

	function makeServer(luaUdp = null) {
		const server = new FactorioServer(
			path.join("test", "file", "factorio"), path.join("temp", "test", "server_ports"),
			path.join("test", "file", "factorio", "0.1.2", "data"), "2.1.10",
			{ rconPassword: "", ports: { game: 34197, rcon: 34198, luaUdp } },
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
			it("passes the ports it was created with to Factorio", async function() {
				await makeServer({ factorio: 40000, host: 40001 })[method]("save");
				const { args } = spawned[0];
				assert.equal(argValue(args, "--port"), 34197);
				assert.equal(argValue(args, "--rcon-port"), 34198);
				assert.equal(argValue(args, "--enable-lua-udp"), 40000);
			});
			it("does not enable Lua UDP without Lua UDP ports", async function() {
				await makeServer()[method]("save");
				assert.equal(argValue(spawned[0].args, "--enable-lua-udp"), undefined);
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
			const server = makeServer({ factorio: 40000, host: port });
			await server._startUdp();
			assert.equal(server.hostUdpPort, port);
			server._stopUdp();
			assert.equal(server.hostUdpPort, undefined);
		});
		it("raises an error if the host UDP port is taken", async function() {
			const port = held.address().port;
			const server = makeServer({ factorio: 40000, host: port });
			await assert.rejects(
				server._startUdp(),
				err => err instanceof lib.EnvironmentError
					&& err.message.startsWith(`Failed to bind host Lua UDP socket to port ${port}:`),
			);
			assert.equal(server._udpSocket, null);
		});
	});
});
