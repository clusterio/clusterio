import assert from "node:assert/strict";
import dgram from "node:dgram";
import events from "node:events";
import net from "node:net";

import * as lib from "@clusterio/lib";
import {
	PortRegistry, configuredPortClaims, probePort,
} from "@clusterio/host/dist/node/src/ports.js";
import "../setup_logging.js";

const inst1 = { instanceId: 1, instanceName: "inst1" };

function instanceConfig(id, fields = {}) {
	return new lib.InstanceConfig("host", { "instance.id": id, "instance.name": `inst${id}`, ...fields });
}

// Probe stand-in, records if it was closed.
function fakeBound(port) {
	return { port, closed: false, async close() { this.closed = true; } };
}

function failNextListen(prototype, method, code, match = () => true) {
	const original = prototype[method];
	let calls = 0;
	prototype[method] = function(...args) {
		calls += 1;
		if (match(args)) {
			queueMicrotask(() => this.emit("error", Object.assign(new Error(code), { code })));
			return this;
		}
		return original.apply(this, args);
	};
	return { restore: () => { prototype[method] = original; }, calls: () => calls };
}

describe("host/src/ports", function() {
	describe("configuredPortClaims()", function() {
		it("claims positive fixed ports with their endpoint and protocol", function() {
			const config = instanceConfig(1, {
				"factorio.game_port": 34197,
				"factorio.rcon_port": 34197,
				"factorio.enable_lua_udp": true,
				"factorio.lua_udp_port": 40000,
			});
			assert.deepEqual(configuredPortClaims(config), [
				{ ...inst1, endpoint: "game", protocol: "udp", port: 34197, field: "factorio.game_port" },
				{ ...inst1, endpoint: "rcon", protocol: "tcp", port: 34197, field: "factorio.rcon_port" },
				{ ...inst1, endpoint: "lua_udp", protocol: "udp", port: 40000, field: "factorio.lua_udp_port" },
			]);
		});
		it("does not claim null or zero ports", function() {
			const config = instanceConfig(1, {
				"factorio.game_port": 0,
				"factorio.host_assigned_game_port": 34100,
				"factorio.rcon_port": 0,
				"factorio.enable_lua_udp": true,
				"factorio.lua_udp_port": 0,
			});
			assert.deepEqual(configuredPortClaims(config), []);
			assert.deepEqual(configuredPortClaims(instanceConfig(1, { "factorio.enable_lua_udp": true })), []);
		});
		it("claims the host assigned game port when game_port is null", function() {
			const config = instanceConfig(1, { "factorio.host_assigned_game_port": 34100 });
			assert.deepEqual(configuredPortClaims(config), [
				{ ...inst1, endpoint: "game", protocol: "udp", port: 34100, field: "factorio.host_assigned_game_port" },
			]);
		});
		it("does not claim the Lua UDP port when Lua UDP is disabled", function() {
			const config = instanceConfig(1, { "factorio.lua_udp_port": 40000 });
			assert.deepEqual(configuredPortClaims(config), []);
		});
	});

	describe("probePort()", function() {
		for (const protocol of ["tcp", "udp"]) {
			it(`returns a ${protocol} port that is bound until closed`, async function() {
				const bound = await probePort(protocol);
				try {
					assert(bound.port > 0);
					if (protocol === "tcp") {
						const other = net.createServer();
						other.listen({ host: "0.0.0.0", port: bound.port });
						const [err] = await events.once(other, "error");
						assert.equal(err.code, "EADDRINUSE");
					} else {
						const other = dgram.createSocket("udp4");
						other.bind(bound.port, "0.0.0.0");
						const [err] = await events.once(other, "error");
						assert.equal(err.code, "EADDRINUSE");
						other.close();
					}
				} finally {
					await bound.close();
				}
			});
		}

		it("binds the given port", async function() {
			const free = await probePort("udp");
			await free.close();
			const bound = await probePort("udp", free.port);
			try {
				assert.equal(bound.port, free.port);
				await assert.rejects(probePort("udp", free.port), { code: "EADDRINUSE" });
			} finally {
				await bound.close();
			}
		});

		for (const host of ["127.0.0.1", "::1"]) {
			it(`avoids the local port of an established outgoing connection on ${host}`, async function() {
				const listener = net.createServer();
				try {
					listener.listen({ host, port: 0 });
					await events.once(listener, "listening");
				} catch (err) {
					if (host === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(err.code)) {
						this.skip();
					}
					throw err;
				}
				const accepted = events.once(listener, "connection");
				const client = net.connect({ host, port: listener.address().port });
				const [peer] = await accepted;
				await events.once(client, "connect").catch(() => {});
				try {
					const bound = await probePort("tcp");
					await bound.close();
					assert.notEqual(bound.port, client.localPort);
				} finally {
					client.destroy();
					peer.destroy();
					await new Promise(resolve => listener.close(resolve));
				}
			});
		}

		it("falls back to IPv4 for TCP when IPv6 is unavailable", async function() {
			const stub = failNextListen(
				net.Server.prototype, "listen", "EAFNOSUPPORT", ([options]) => options.host === "::"
			);
			try {
				const bound = await probePort("tcp");
				assert(bound.port > 0);
				await bound.close();
				assert.equal(stub.calls(), 2);
			} finally {
				stub.restore();
			}
		});
		it("falls back to IPv4 for UDP when IPv6 is unavailable", async function() {
			const stub = failNextListen(
				dgram.Socket.prototype, "bind", "EADDRNOTAVAIL", ([, address]) => address === "::"
			);
			try {
				const bound = await probePort("udp");
				assert(bound.port > 0);
				await bound.close();
				assert.equal(stub.calls(), 2);
			} finally {
				stub.restore();
			}
		});
		for (const [protocol, prototype, method] of [
			["tcp", net.Server.prototype, "listen"], ["udp", dgram.Socket.prototype, "bind"],
		]) {
			it(`propagates ${protocol} permission errors without retrying`, async function() {
				const stub = failNextListen(prototype, method, "EACCES");
				try {
					await assert.rejects(probePort(protocol), { code: "EACCES" });
					assert.equal(stub.calls(), 1);
				} finally {
					stub.restore();
				}
			});
		}
	});

	describe("class PortRegistry", function() {
		let instances;
		let registry;
		beforeEach(function() {
			instances = new Map();
			registry = new PortRegistry(instances);
		});
		function assign(id, fields = {}) {
			instances.set(id, { config: instanceConfig(id, fields) });
		}
		function reserve(id, fields = {}, range = new Set()) {
			return registry.reserve(instanceConfig(id, fields), range);
		}
		function fakeProbes(ports) {
			const probes = ports.map(fakeBound);
			const queue = [...probes];
			registry._probe = async () => queue.shift();
			return probes;
		}

		describe(".isClaimed()", function() {
			it("follows the config of assigned instances", function() {
				assign(1, { "factorio.rcon_port": 1000 });
				assert(registry.isClaimed("tcp", 1000));
				instances.get(1).config.set("factorio.rcon_port", 2000);
				assert(!registry.isClaimed("tcp", 1000));
				assert(registry.isClaimed("tcp", 2000));
				instances.delete(1);
				assert(!registry.isClaimed("tcp", 2000));
			});
			it("ignores claims by the excluded instance and endpoint", function() {
				assign(1, { "factorio.host_assigned_game_port": 34100 });
				assert(!registry.isClaimed("udp", 34100, { instanceId: 1, endpoint: "game" }));
				assert(registry.isClaimed("udp", 34100, { instanceId: 1, endpoint: "lua_udp" }));
				assert(registry.isClaimed("udp", 34100, { instanceId: 2, endpoint: "game" }));
			});
			it("keeps TCP and UDP separate", async function() {
				await reserve(1, { "factorio.game_port": 34197, "factorio.rcon_port": 1000 });
				assert(registry.isClaimed("tcp", 1000));
				assert(!registry.isClaimed("udp", 1000));
			});
		});

		describe(".configuredConflicts()", function() {
			it("reports fixed ports configured on another instance with owner and endpoint", function() {
				assign(1, { "factorio.game_port": 34197 });
				assign(2, { "factorio.enable_lua_udp": true, "factorio.lua_udp_port": 34197 });
				assert.deepEqual(registry.configuredConflicts(2), [
					'factorio.lua_udp_port 34197 (UDP) is also the game port of instance "inst1" (ID 1), ' +
					"only one of them can be running",
				]);
			});
			it("reports fixed ports used twice by the same instance", function() {
				assign(1, {
					"factorio.game_port": 34197, "factorio.enable_lua_udp": true, "factorio.lua_udp_port": 34197,
				});
				const conflicts = registry.configuredConflicts(1);
				assert.equal(conflicts.length, 2);
				assert.match(conflicts[0], /game_port 34197 \(UDP\) is also the Lua UDP port of the same instance/);
			});
			it("does not report the same port on TCP and UDP", function() {
				assign(1, { "factorio.game_port": 34197 });
				assign(2, { "factorio.rcon_port": 34197 });
				assert.deepEqual(registry.configuredConflicts(2), []);
			});
			it("does not report host assigned game ports", function() {
				assign(1, { "factorio.host_assigned_game_port": 34100 });
				assign(2, { "factorio.game_port": 34100 });
				assert.deepEqual(registry.configuredConflicts(2), []);
			});
		});

		describe(".reserve()", function() {
			it("uses fixed ports as is and picks the rest", async function() {
				fakeProbes([2000, 2001, 2002]);
				const reservation = await reserve(1, {
					"factorio.game_port": 34197, "factorio.enable_lua_udp": true,
				});
				assert.deepEqual(reservation.ports, {
					game: 34197, rcon: 2000, luaUdp: { factorio: 2001, host: 2002 },
				});
				assert.deepEqual(reservation.claims.map(c => [c.endpoint, c.protocol, c.port]), [
					["game", "udp", 34197], ["rcon", "tcp", 2000],
					["lua_udp", "udp", 2001], ["host_lua_udp", "udp", 2002],
				]);
			});
			it("has no Lua UDP ports when Lua UDP is disabled", async function() {
				const reservation = await reserve(1, { "factorio.game_port": 34197, "factorio.lua_udp_port": 40000 });
				assert.equal(reservation.ports.luaUdp, null);
				assert(!registry.isClaimed("udp", 40000));
			});
			it("picks any free port for game_port 0 and from the range for null", async function() {
				fakeProbes([2000, 2001]);
				const any = await reserve(1, { "factorio.game_port": 0 });
				assert.equal(any.ports.game, 2000);
				registry._probe = async (protocol, port) => fakeBound(port || 3000);
				const ranged = await reserve(2, {}, new Set([34100]));
				assert.equal(ranged.ports.game, 34100);
			});
			it("rejects a fixed port reserved for another instance with owner and endpoint", async function() {
				await reserve(1, { "factorio.game_port": 34197, "factorio.rcon_port": 1000 });
				await assert.rejects(
					reserve(2, { "factorio.game_port": 34198, "factorio.rcon_port": 1000 }),
					new lib.ConflictError(
						'Cannot use TCP port 1000 for the RCON port of instance "inst2" (ID 2), ' +
						'it is in use by the RCON port of instance "inst1" (ID 1)'
					),
				);
				assert(!registry.isClaimed("udp", 34198), "partial reservation was kept");
			});
			it("rejects the same fixed UDP port for two endpoints of one instance", async function() {
				await assert.rejects(
					reserve(1, {
						"factorio.game_port": 34197, "factorio.enable_lua_udp": true, "factorio.lua_udp_port": 34197,
					}),
					/Lua UDP port of instance "inst1" \(ID 1\), it is in use by the game port of instance "inst1"/,
				);
			});
			it("allows a fixed port configured on a stopped instance", async function() {
				assign(1, { "factorio.rcon_port": 1000 });
				const reservation = await reserve(2, { "factorio.game_port": 34197, "factorio.rcon_port": 1000 });
				assert.equal(reservation.ports.rcon, 1000);
			});
			it("releases what it reserved if picking a free port fails", async function() {
				registry._probe = async () => { throw new Error("probe failed"); };
				await assert.rejects(reserve(1, { "factorio.game_port": 34197 }), /probe failed/);
				assert(!registry.isClaimed("udp", 34197));
			});
			it("keeps concurrent reservations distinct", async function() {
				const reservations = await Promise.all(Array.from({ length: 16 }, (_, i) => reserve(i, {
					"factorio.game_port": 0, "factorio.enable_lua_udp": true,
				})));
				const udp = reservations.flatMap(r => [r.ports.game, r.ports.luaUdp.factorio, r.ports.luaUdp.host]);
				assert.equal(new Set(udp).size, udp.length);
				assert.equal(new Set(reservations.map(r => r.ports.rcon)).size, reservations.length);
			});
			it("leaves the picked ports unbound", async function() {
				const { ports } = await reserve(1, { "factorio.game_port": 34197 });
				const server = net.createServer();
				server.listen({ host: "0.0.0.0", port: ports.rcon });
				await events.once(server, "listening");
				await new Promise(resolve => server.close(resolve));
			});
		});

		describe("picking a free port", function() {
			it("skips ports configured on stopped instances and reserved for running ones", async function() {
				assign(1, { "factorio.rcon_port": 1000 });
				await reserve(2, { "factorio.game_port": 34197, "factorio.rcon_port": 1001 });
				const probes = fakeProbes([1000, 1001, 1002]);
				const reservation = await reserve(3, { "factorio.game_port": 34198 });
				assert.equal(reservation.ports.rcon, 1002);
				assert(probes.every(probe => probe.closed));
			});
			it("does not skip a port only claimed on the other protocol", async function() {
				assign(1, { "factorio.game_port": 1000 });
				fakeProbes([1000]);
				assert.equal((await reserve(2, { "factorio.game_port": 34197 })).ports.rcon, 1000);
			});
			it("gives up after 100 claimed ports", async function() {
				await reserve(1, { "factorio.game_port": 34197, "factorio.rcon_port": 1000 });
				const probes = fakeProbes(Array(101).fill(1000));
				await assert.rejects(
					reserve(2, { "factorio.game_port": 34198 }),
					new lib.EnvironmentError('No free TCP port found for the RCON port of instance "inst2" (ID 2)'),
				);
				assert.equal(probes.filter(probe => probe.closed).length, 100);
			});
			it("closes skipped probes if probing fails", async function() {
				await reserve(1, { "factorio.game_port": 34197, "factorio.rcon_port": 1000 });
				const skipped = fakeBound(1000);
				let calls = 0;
				registry._probe = async () => {
					calls += 1;
					if (calls > 1) {
						throw Object.assign(new Error("denied"), { code: "EACCES" });
					}
					return skipped;
				};
				await assert.rejects(reserve(2, { "factorio.game_port": 34198 }), { code: "EACCES" });
				assert(skipped.closed);
			});

			describe("from a range", function() {
				const range = new Set([34100, 34101, 34102]);
				let busy;
				let probed;
				beforeEach(function() {
					busy = new Set();
					probed = [];
					registry._probe = async (protocol, port) => {
						if (protocol === "tcp") {
							return fakeBound(1000);
						}
						probed.push(port);
						if (busy.has(port)) {
							throw Object.assign(new Error("in use"), { code: "EADDRINUSE" });
						}
						return fakeBound(port);
					};
				});
				function reserveGame(id, preferred = null) {
					return reserve(id, { "factorio.host_assigned_game_port": preferred }, range);
				}

				it("tries the preferred port first", async function() {
					assert.equal((await reserveGame(1, 34102)).ports.game, 34102);
					assert.deepEqual(probed, [34102]);
				});
				it("ignores a preferred port outside the range", async function() {
					assert.equal((await reserveGame(1, 40000)).ports.game, 34100);
				});
				it("skips claimed ports without probing them and ports other processes use", async function() {
					assign(2, { "factorio.game_port": 34100 });
					busy.add(34101);
					assert.equal((await reserveGame(1, 34100)).ports.game, 34102);
					assert.deepEqual(probed, [34101, 34102]);
				});
				it("does not skip its own host assigned game port", async function() {
					assign(1, { "factorio.host_assigned_game_port": 34101 });
					assert.equal((await reserveGame(1, 34101)).ports.game, 34101);
				});
				it("rejects when every port in the range is taken", async function() {
					await reserve(2, { "factorio.game_port": 34100, "factorio.rcon_port": 2000 });
					busy.add(34101);
					busy.add(34102);
					await assert.rejects(
						reserveGame(1),
						new lib.ConflictError(
							'No free UDP port left in the range for the game port of instance "inst1" (ID 1) ' +
							"(2 in use by other processes)"
						),
					);
				});
				it("gives concurrent reservations different ports", async function() {
					registry._probe = async (protocol, port) => fakeBound(port || 1000 + probed.push(0));
					const reservations = await Promise.all([1, 2, 3].map(id => reserveGame(id)));
					assert.deepEqual(reservations.map(r => r.ports.game).sort(), [...range]);
				});
				it("propagates errors other than the port being in use", async function() {
					busy.add(34100);
					registry._probe = async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
					await assert.rejects(reserveGame(1), { code: "EACCES" });
				});
			});
		});
	});

	describe("class PortReservation", function() {
		let instances;
		let registry;
		beforeEach(function() {
			instances = new Map();
			registry = new PortRegistry(instances);
		});

		it("frees its ports once released", async function() {
			const reservation = await registry.reserve(
				instanceConfig(1, { "factorio.game_port": 34197, "factorio.rcon_port": 1000 }), new Set()
			);
			assert(!reservation.released);
			reservation.release();
			assert(reservation.released);
			assert(!registry.isClaimed("tcp", 1000));
			assert(!registry.isClaimed("udp", 34197));
		});
		it("does not free the ports of a later run of the same instance", async function() {
			const config = instanceConfig(1, { "factorio.game_port": 34197, "factorio.rcon_port": 1000 });
			const first = await registry.reserve(config, new Set());
			first.release();
			const second = await registry.reserve(config, new Set());
			first.release();
			assert(!second.released);
			assert(registry.isClaimed("tcp", 1000));
		});
	});
});
