import assert from "node:assert/strict";
import dgram from "node:dgram";
import events from "node:events";
import net from "node:net";

import * as lib from "@clusterio/lib";
import {
	PortRegistry, configuredPortClaims, probeFreePort,
} from "@clusterio/host/dist/node/src/ports.js";
import "../setup_logging.js";

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
				{ owner: 1, endpoint: "game", protocol: "udp", port: 34197, field: "factorio.game_port" },
				{ owner: 1, endpoint: "rcon", protocol: "tcp", port: 34197, field: "factorio.rcon_port" },
				{ owner: 1, endpoint: "lua_udp", protocol: "udp", port: 40000, field: "factorio.lua_udp_port" },
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
				{ owner: 1, endpoint: "game", protocol: "udp", port: 34100, field: "factorio.host_assigned_game_port" },
			]);
		});
		it("does not claim the Lua UDP port when Lua UDP is disabled", function() {
			const config = instanceConfig(1, { "factorio.lua_udp_port": 40000 });
			assert.deepEqual(configuredPortClaims(config), []);
		});
	});

	describe("probeFreePort()", function() {
		for (const protocol of ["tcp", "udp"]) {
			it(`returns a ${protocol} port that is bound until closed`, async function() {
				const bound = await probeFreePort(protocol);
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
					const bound = await probeFreePort("tcp");
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
				const bound = await probeFreePort("tcp");
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
				const bound = await probeFreePort("udp");
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
					await assert.rejects(probeFreePort(protocol), { code: "EACCES" });
					assert.equal(stub.calls(), 1);
				} finally {
					stub.restore();
				}
			});
		}
	});

	describe("class PortRegistry", function() {
		let registry;
		beforeEach(function() {
			registry = new PortRegistry(owner => `instance "inst${owner}"`);
		});

		describe(".setConfigured()", function() {
			it("replaces the claims of an instance", function() {
				registry.setConfigured(1, instanceConfig(1, { "factorio.rcon_port": 1000 }));
				assert(registry.isClaimed("tcp", 1000));
				registry.setConfigured(1, instanceConfig(1, { "factorio.rcon_port": 2000 }));
				assert(!registry.isClaimed("tcp", 1000));
				assert(registry.isClaimed("tcp", 2000));
			});
			it("reports fixed ports configured on another instance with owner and endpoint", function() {
				registry.setConfigured(1, instanceConfig(1, { "factorio.game_port": 34197 }));
				const conflicts = registry.setConfigured(2, instanceConfig(2, {
					"factorio.enable_lua_udp": true, "factorio.lua_udp_port": 34197,
				}));
				assert.deepEqual(conflicts, [
					'factorio.lua_udp_port 34197 (UDP) is also the game port of instance "inst1", ' +
					"only one of them can be running",
				]);
			});
			it("reports fixed ports used twice by the same instance", function() {
				const conflicts = registry.setConfigured(1, instanceConfig(1, {
					"factorio.game_port": 34197, "factorio.enable_lua_udp": true, "factorio.lua_udp_port": 34197,
				}));
				assert.equal(conflicts.length, 2);
				assert.match(conflicts[0], /game_port 34197 \(UDP\) is also the Lua UDP port of the same instance/);
			});
			it("does not report the same port on TCP and UDP", function() {
				registry.setConfigured(1, instanceConfig(1, { "factorio.game_port": 34197 }));
				assert.deepEqual(registry.setConfigured(2, instanceConfig(2, { "factorio.rcon_port": 34197 })), []);
			});
			it("does not report host assigned game ports", function() {
				registry.setConfigured(1, instanceConfig(1, { "factorio.host_assigned_game_port": 34100 }));
				assert.deepEqual(registry.setConfigured(2, instanceConfig(2, { "factorio.game_port": 34100 })), []);
			});
			it("does not report again if the claims did not change", function() {
				registry.setConfigured(1, instanceConfig(1, { "factorio.rcon_port": 1000 }));
				const config = instanceConfig(2, { "factorio.rcon_port": 1000 });
				assert.equal(registry.setConfigured(2, config).length, 1);
				assert.equal(registry.setConfigured(2, config).length, 0);
			});
		});

		describe(".clearConfigured()", function() {
			it("removes the claims of an instance", function() {
				registry.setConfigured(1, instanceConfig(1, { "factorio.rcon_port": 1000 }));
				registry.clearConfigured(1);
				assert(!registry.isClaimed("tcp", 1000));
			});
			it("keeps reservations of the instance", function() {
				registry.setConfigured(1, instanceConfig(1, { "factorio.rcon_port": 1000 }));
				registry.reserveFixed(1, "rcon", "tcp", 1000);
				registry.clearConfigured(1);
				assert(registry.isClaimed("tcp", 1000));
			});
		});

		describe(".isClaimed()", function() {
			it("ignores claims by the excluded owner and endpoint", function() {
				registry.setConfigured(1, instanceConfig(1, { "factorio.host_assigned_game_port": 34100 }));
				assert(!registry.isClaimed("udp", 34100, { owner: 1, endpoint: "game" }));
				assert(registry.isClaimed("udp", 34100, { owner: 1, endpoint: "lua_udp" }));
				assert(registry.isClaimed("udp", 34100, { owner: 2, endpoint: "game" }));
			});
			it("keeps TCP and UDP separate", function() {
				registry.reserveFixed(1, "rcon", "tcp", 1000);
				assert(registry.isClaimed("tcp", 1000));
				assert(!registry.isClaimed("udp", 1000));
			});
		});

		describe(".reserveFixed()", function() {
			it("rejects a port reserved by another instance with owner and endpoint", function() {
				registry.reserveFixed(1, "rcon", "tcp", 1000);
				assert.throws(
					() => registry.reserveFixed(2, "rcon", "tcp", 1000),
					new lib.ConflictError(
						'Cannot use TCP port 1000 for the RCON port of instance "inst2", ' +
						'it is in use by the RCON port of instance "inst1"'
					),
				);
				assert.deepEqual(registry.reserved(2), []);
			});
			it("rejects a port reserved by another endpoint of the same instance", function() {
				registry.reserveFixed(1, "game", "udp", 34197);
				assert.throws(
					() => registry.reserveFixed(1, "lua_udp", "udp", 34197),
					/Lua UDP port of instance "inst1", it is in use by the game port of instance "inst1"/,
				);
			});
			it("allows a port configured on a stopped instance", function() {
				registry.setConfigured(1, instanceConfig(1, { "factorio.rcon_port": 1000 }));
				assert.equal(registry.reserveFixed(2, "rcon", "tcp", 1000), 1000);
			});
			it("allows TCP and UDP to share a port number", function() {
				registry.reserveFixed(1, "game", "udp", 34197);
				registry.reserveFixed(1, "rcon", "tcp", 34197);
				assert.deepEqual(registry.reserved(1), [
					{ owner: 1, endpoint: "game", protocol: "udp", port: 34197 },
					{ owner: 1, endpoint: "rcon", protocol: "tcp", port: 34197 },
				]);
			});
		});

		describe(".release()", function() {
			it("frees all ports of the instance", function() {
				registry.reserveFixed(1, "game", "udp", 34197);
				registry.reserveFixed(1, "rcon", "tcp", 1000);
				registry.reserveFixed(2, "rcon", "tcp", 1001);
				registry.release(1);
				assert.deepEqual(registry.reserved(1), []);
				assert(!registry.isClaimed("udp", 34197));
				registry.reserveFixed(3, "rcon", "tcp", 1000);
				assert(registry.isClaimed("tcp", 1001));
			});
		});

		describe(".reserveFree()", function() {
			function fakeProbes(ports) {
				const probes = ports.map(fakeBound);
				const queue = [...probes];
				registry._probe = async () => queue.shift();
				return probes;
			}
			it("skips ports configured on stopped instances and reserved by running ones", async function() {
				registry.setConfigured(1, instanceConfig(1, { "factorio.rcon_port": 1000 }));
				registry.reserveFixed(2, "rcon", "tcp", 1001);
				const probes = fakeProbes([1000, 1001, 1002]);
				assert.equal(await registry.reserveFree(3, "rcon", "tcp"), 1002);
				assert.deepEqual(registry.reserved(3), [{ owner: 3, endpoint: "rcon", protocol: "tcp", port: 1002 }]);
				assert(probes.every(probe => probe.closed));
			});
			it("does not skip a port only claimed on the other protocol", async function() {
				registry.setConfigured(1, instanceConfig(1, { "factorio.game_port": 1000 }));
				fakeProbes([1000]);
				assert.equal(await registry.reserveFree(2, "rcon", "tcp"), 1000);
			});
			it("gives up after 100 claimed ports", async function() {
				registry.reserveFixed(1, "rcon", "tcp", 1000);
				const probes = fakeProbes(Array(101).fill(1000));
				await assert.rejects(
					registry.reserveFree(2, "rcon", "tcp"),
					new lib.EnvironmentError('No free TCP port found for the RCON port of instance "inst2"'),
				);
				assert.equal(probes.filter(probe => probe.closed).length, 100);
			});
			it("closes skipped probes if probing fails", async function() {
				registry.reserveFixed(1, "rcon", "tcp", 1000);
				const skipped = fakeBound(1000);
				let calls = 0;
				registry._probe = async () => {
					calls += 1;
					if (calls > 1) {
						throw Object.assign(new Error("denied"), { code: "EACCES" });
					}
					return skipped;
				};
				await assert.rejects(registry.reserveFree(2, "rcon", "tcp"), { code: "EACCES" });
				assert(skipped.closed);
			});
			for (const protocol of ["tcp", "udp"]) {
				// eslint-disable-next-line no-loop-func
				it(`keeps concurrent ${protocol} reservations distinct`, async function() {
					const ports = await Promise.all(
						Array.from({ length: 32 }, (_, i) => registry.reserveFree(i, "rcon", protocol))
					);
					assert.equal(new Set(ports).size, ports.length);
					for (const port of ports) {
						assert(registry.isClaimed(protocol, port));
					}
				});
			}
			it("leaves the port unbound", async function() {
				const port = await registry.reserveFree(1, "rcon", "tcp");
				const server = net.createServer();
				server.listen({ host: "0.0.0.0", port });
				await events.once(server, "listening");
				await new Promise(resolve => server.close(resolve));
			});
		});
	});
});
