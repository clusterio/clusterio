import assert from "node:assert/strict";
import childProcess from "node:child_process";
import events from "node:events";
import path from "node:path";

import * as lib from "@clusterio/lib";
import { FactorioServer } from "@clusterio/host/dist/node/src/server.js";
import { PortRegistry } from "@clusterio/host/dist/node/src/ports.js";
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

function claimsOf(registry, owner) {
	return [...registry._reservations]
		.filter(reservation => reservation.owner === owner)
		.map(({ endpoint, protocol, port }) => ({ endpoint, protocol, port }))
		.sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

describe("host/src/server", function() {
	describe("class FactorioServer", function() {
		let spawn;
		let spawned;
		let registry;
		let servers;
		beforeEach(function() {
			spawn = childProcess.spawn;
			spawned = [];
			childProcess.spawn = (command, args) => {
				const process = new FakeProcess();
				spawned.push({ args, process });
				return process;
			};
			registry = new PortRegistry(owner => `instance ${owner}`);
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

		function makeServer(options = {}, owner = 1) {
			const server = new FactorioServer(
				path.join("test", "file", "factorio"), path.join("temp", "test", "server_ports"),
				path.join("test", "file", "factorio", "0.1.2", "data"), "2.1.10",
				{ rconPassword: "", portRegistry: registry, portOwner: owner, ...options },
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

		function startTests(method) {
			describe(`.${method}()`, function() {
				it("reserves fixed ports and passes them to Factorio", async function() {
					const server = makeServer({
						gamePort: 34197, rconPort: 34197, enableLuaUdp: true, luaUdpPort: 40000,
					});
					await server[method]("save");
					const { args } = spawned[0];
					assert.equal(argValue(args, "--port"), 34197);
					assert.equal(argValue(args, "--rcon-port"), 34197);
					assert.equal(argValue(args, "--enable-lua-udp"), 40000);
					assert.deepEqual(claimsOf(registry, 1), [
						{ endpoint: "game", protocol: "udp", port: 34197 },
						{ endpoint: "lua_udp", protocol: "udp", port: 40000 },
						{ endpoint: "rcon", protocol: "tcp", port: 34197 },
					]);
				});
				it("reserves free ports for unset and zero ports", async function() {
					const server = makeServer({ gamePort: 0, enableLuaUdp: true, luaUdpPort: 0 });
					assert.equal(server.rconPort, 0);
					await server[method]("save");
					const { args } = spawned[0];
					for (const [flag, endpoint] of [
						["--port", "game"], ["--rcon-port", "rcon"], ["--enable-lua-udp", "lua_udp"],
					]) {
						const port = argValue(args, flag);
						assert(port > 0, `${flag} not set`);
						assert.equal(server._reservations[endpoint].port, port);
					}
					assert.equal(server.gamePort, argValue(args, "--port"));
					assert.equal(server.rconPort, argValue(args, "--rcon-port"));
					assert.equal(server.luaUdpPort, argValue(args, "--enable-lua-udp"));
				});
				it("does not reserve a Lua UDP port when Lua UDP is disabled", async function() {
					const server = makeServer({ luaUdpPort: 40000 });
					await server[method]("save");
					assert.equal(argValue(spawned[0].args, "--enable-lua-udp"), undefined);
					assert.deepEqual(claimsOf(registry, 1).map(c => c.endpoint), ["game", "rcon"]);
				});
				it("reserves fixed ports before picking free ones", async function() {
					const server = makeServer({ enableLuaUdp: true, luaUdpPort: 40000 });
					const order = [];
					const reserve = registry.reserve.bind(registry);
					registry.reserve = (...args) => { order.push(args[1]); return reserve(...args); };
					await server[method]("save");
					assert.equal(order[0], "lua_udp");
				});
				it("rejects a fixed port reserved by another running server", async function() {
					await makeServer({ rconPort: 1000 }, 2)[method]("save");
					const server = makeServer({ gamePort: 34197, rconPort: 1000 });
					await assert.rejects(
						server[method]("save"),
						new lib.ConflictError(
							"Cannot use TCP port 1000 for the RCON port of instance 1, " +
							"it is in use by the RCON port of instance 2"
						),
					);
					assert.equal(server._state, "init");
					assert.equal(spawned.length, 1);
					assert.deepEqual(claimsOf(registry, 1), []);
				});
				it("rejects the same fixed UDP port for the game and Lua UDP", async function() {
					const server = makeServer({ gamePort: 34197, enableLuaUdp: true, luaUdpPort: 34197 });
					await assert.rejects(server[method]("save"), /in use by the game port of instance 1/);
					assert.deepEqual(claimsOf(registry, 1), []);
				});
				it("allows a fixed port configured on a stopped instance", async function() {
					const stopped = new lib.InstanceConfig("host", { "instance.id": 2, "factorio.rcon_port": 1000 });
					registry.setConfigured(2, stopped);
					const server = makeServer({ rconPort: 1000 });
					await server[method]("save");
					assert.equal(argValue(spawned[0].args, "--rcon-port"), 1000);
				});
				it("rejects overlapping starts without changing the first process's ports", async function() {
					const server = makeServer();
					const results = await Promise.allSettled([server[method]("save"), server[method]("save")]);
					assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
					const rejected = results.find(result => result.status === "rejected");
					assert.match(rejected.reason.message, /Expected state init but state is running/);
					assert.equal(spawned.length, 1);
					assert.equal(argValue(spawned[0].args, "--rcon-port"), server.rconPort);
					assert.deepEqual(claimsOf(registry, 1).map(c => c.endpoint), ["game", "rcon"]);
				});
				it("keeps runtime reservations when the config changes until the process exits", async function() {
					const config = new lib.InstanceConfig("host", { "instance.id": 1, "factorio.rcon_port": 1000 });
					registry.setConfigured(1, config);
					const server = makeServer({ rconPort: 1000 });
					await server[method]("save");
					config.set("factorio.rcon_port", 2000);
					registry.setConfigured(1, config);
					assert(registry.isClaimed("tcp", 1000));
					assert(registry.isClaimed("tcp", 2000));

					server._state = "stopping";
					spawned[0].process.emit("exit", 0, null);
					assert(!registry.isClaimed("tcp", 1000));
					assert(registry.isClaimed("tcp", 2000));
				});
				it("releases its reservations on normal exit", async function() {
					const server = makeServer({ enableLuaUdp: true });
					await server[method]("save");
					await server._startUdp();
					assert.equal(claimsOf(registry, 1).length, 4);
					const exited = events.once(server, "exit");
					server._state = "stopping";
					spawned[0].process.emit("exit", 0, null);
					await exited;
					assert.deepEqual(claimsOf(registry, 1), []);
					assert.equal(server.hostUdpPort, undefined);
					assert.equal(server.rconPort, 0);
				});
				it("releases its reservations on unexpected exit", async function() {
					const server = makeServer();
					server.on("error", () => {});
					await server[method]("save");
					spawned[0].process.emit("exit", 1, null);
					assert.deepEqual(claimsOf(registry, 1), []);
				});
				it("releases its reservations if spawning fails", async function() {
					const server = makeServer();
					const errors = [];
					server.on("error", err => errors.push(err));
					await server[method]("save");
					spawned[0].process.emit("error", Object.assign(new Error("spawn failed"), { code: "EACCES" }));
					assert.match(errors[0].message, /Permission denied/);
					assert.deepEqual(claimsOf(registry, 1), []);
					assert.equal(server._state, "init");
				});
				it("releases its reservations if preparing the process throws", async function() {
					const server = makeServer();
					// eslint-disable-next-line node/no-sync
					server._writeConfigIniSync = () => { throw new Error("preparation failed"); };
					await assert.rejects(server[method]("save"), /preparation failed/);
					assert.deepEqual(claimsOf(registry, 1), []);
					assert.equal(server._state, "init");
				});
				it("releases its reservations if the Lua UDP version check fails", async function() {
					const server = makeServer({ enableLuaUdp: true });
					server._version = "2.1.9";
					await assert.rejects(server[method]("save"), /Lua UDP requires Factorio 2.1.10/);
					assert.deepEqual(claimsOf(registry, 1), []);
				});
				it("reserves its ports again when restarted", async function() {
					const server = makeServer({ gamePort: 34197 });
					await server[method]("save");
					server._state = "stopping";
					spawned[0].process.emit("exit", 0, null);
					await server[method]("save");
					assert.equal(argValue(spawned[1].args, "--port"), 34197);
					assert.equal(server._reservations.rcon.port, argValue(spawned[1].args, "--rcon-port"));
					assert.deepEqual(claimsOf(registry, 1).map(c => c.endpoint), ["game", "rcon"]);
				});
				it("frees its ports for another server once stopped", async function() {
					const first = makeServer({ rconPort: 1000 });
					await first[method]("save");
					first._state = "stopping";
					spawned[0].process.emit("exit", 0, null);
					await makeServer({ rconPort: 1000 }, 2)[method]("save");
					assert.equal(argValue(spawned[1].args, "--rcon-port"), 1000);
				});
			});
		}
		startTests("start");
		startTests("startScenario");

		describe("._startUdp()", function() {
			it("reserves the host socket port and releases it when stopped", async function() {
				const server = makeServer({ enableLuaUdp: true });
				await server._startUdp();
				const port = server.hostUdpPort;
				assert(port > 0);
				assert.equal(server._udpSocket.address().port, port);
				assert.deepEqual(claimsOf(registry, 1), [{ endpoint: "host_lua_udp", protocol: "udp", port }]);
				server._stopUdp();
				assert.deepEqual(claimsOf(registry, 1), []);
			});
			it("does not take a port claimed by another instance", async function() {
				const server = makeServer({ enableLuaUdp: true });
				const reserveSocket = registry.reserveSocket.bind(registry);
				let claimed;
				registry.reserveSocket = (owner, endpoint, protocol, bind) => reserveSocket(
					owner, endpoint, protocol, async () => {
						const bound = await bind();
						if (claimed === undefined) {
							// Claim the first port the OS hands out, as if a stopped instance had it configured.
							claimed = bound.port;
							registry.setConfigured(2, new lib.InstanceConfig("host", {
								"instance.id": 2, "factorio.enable_lua_udp": true, "factorio.lua_udp_port": claimed,
							}));
						}
						return bound;
					}
				);
				await server._startUdp();
				assert.notEqual(server.hostUdpPort, claimed);
			});
			it("releases the port if the server exits while binding", async function() {
				const server = makeServer({ enableLuaUdp: true });
				server._server = new FakeProcess();
				const starting = server._startUdp();
				server._server = null;
				await starting;
				assert.equal(server._udpSocket, null);
				assert.deepEqual(claimsOf(registry, 1), []);
			});
		});
	});
});
