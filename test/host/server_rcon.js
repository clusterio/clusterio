import assert from "node:assert/strict";
import childProcess from "node:child_process";
import events from "node:events";
import net from "node:net";

import { InstanceConfig } from "@clusterio/lib";
import { FactorioServer, _reserveRconPort } from "@clusterio/host/dist/node/src/server.js";
import "../setup_logging.js";

async function listen(server, options) {
	const listening = events.once(server, "listening");
	server.listen(options);
	await listening;
}

async function close(server) {
	await new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
}

describe("host/server.ts", function() {
	describe("reserveRconPort()", function() {
		it("keeps concurrent selections distinct until their claims are released", async function() {
			const reservations = await Promise.all(Array.from({ length: 32 }, () => _reserveRconPort()));
			try {
				assert.equal(new Set(reservations.map(entry => entry.port)).size, reservations.length);
			} finally {
				for (const reservation of reservations) {
					reservation.release();
				}
			}
		});

		for (const host of ["127.0.0.1", "::1"]) {
			it(`avoids the local port of an established outgoing connection on ${host}`, async function() {
				const listener = net.createServer();
				try {
					await listen(listener, { host, port: 0 });
				} catch (err) {
					if (host === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(err.code)) {
						this.skip();
					}
					throw err;
				}
				const accepted = events.once(listener, "connection");
				const client = net.connect({ host, port: listener.address().port });
				const connected = events.once(client, "connect");
				const [peer] = await accepted;
				await connected;
				try {
					const reservation = await _reserveRconPort();
					try {
						assert.notEqual(reservation.port, client.localPort);
					} finally {
						reservation.release();
					}
				} finally {
					client.destroy();
					peer.destroy();
					await close(listener);
				}
			});
		}

		it("falls back to IPv4 when IPv6 is unavailable", async function() {
			const original = net.Server.prototype.listen;
			net.Server.prototype.listen = function(options, callback) {
				if (options.host === "::") {
					queueMicrotask(() => this.emit("error", Object.assign(new Error("IPv6 disabled"), {
						code: "EAFNOSUPPORT",
					})));
					return this;
				}
				return original.call(this, options, callback);
			};
			try {
				const reservation = await _reserveRconPort();
				assert(reservation.port > 0);
				reservation.release();
			} finally {
				net.Server.prototype.listen = original;
			}
		});

		it("propagates socket permission errors without retrying", async function() {
			const original = net.Server.prototype.listen;
			const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
			let calls = 0;
			net.Server.prototype.listen = function() {
				calls += 1;
				queueMicrotask(() => this.emit("error", error));
				return this;
			};
			try {
				await assert.rejects(_reserveRconPort(), err => err === error);
				assert.equal(calls, 1);
			} finally {
				net.Server.prototype.listen = original;
			}
		});

	});

	describe("class FactorioServer", function() {
		for (const method of ["start", "startScenario"]) {
			describe(`.${method}()`, function() {
				let spawn;
				let server;
				let args;
				let held;
				beforeEach(async function() {
					held = net.createServer();
					await listen(held, { host: "0.0.0.0", port: 0 });
					spawn = childProcess.spawn;
					childProcess.spawn = (command, argv) => {
						args = argv;
						return new events.EventEmitter();
					};
				});
				afterEach(async function() {
					childProcess.spawn = spawn;
					if (server?._server) {
						server._state = "stopping";
						server._server.emit("exit", 0, null);
					}
					await close(held);
				});

				function makeServer(options) {
					server = new FactorioServer("unused", "unused", options);
					server._state = "init";
					server.binaryPath = () => "unused";
					// eslint-disable-next-line node/no-sync -- Stub the synchronous config writer.
					server._writeConfigIniSync = () => {};
					// eslint-disable-next-line node/no-sync -- Stub the synchronous settings writer.
					server._writeMapSettingsSync = () => {};
					server._attachStdio = () => {};
					server._waitForReady = async () => {};
					return server;
				}

				it("replaces an occupied automatic port before spawning Factorio", async function() {
					makeServer({});
					// Reproduce an initial random selection colliding with an existing socket.
					server.rconPort = held.address().port;
					await server[method]("unused");
					assert.notEqual(server.rconPort, held.address().port);
					assert.equal(args[args.indexOf("--rcon-port") + 1], String(server.rconPort));
					const probe = net.createServer();
					try {
						await listen(probe, { host: "0.0.0.0", port: server.rconPort });
					} finally {
						if (probe.listening) {
							await close(probe);
						}
					}
				});

				it("rejects overlapping starts without changing the first process's port", async function() {
					makeServer({});
					const results = await Promise.allSettled([server[method]("unused"), server[method]("unused")]);
					assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
					const rejected = results.find(result => result.status === "rejected");
					assert.match(rejected.reason.message, /Expected state init but state is running/);
					assert.equal(args[args.indexOf("--rcon-port") + 1], String(server.rconPort));
				});

				it("treats a configured zero port as automatic allocation", async function() {
					const config = new InstanceConfig("host");
					config.set("factorio.rcon_port", 0);
					makeServer({ rconPort: config.get("factorio.rcon_port") });
					server.rconPort = held.address().port;
					await server[method]("unused");
					assert(server.rconPort > 0);
					assert.notEqual(server.rconPort, held.address().port);
					assert.equal(args[args.indexOf("--rcon-port") + 1], String(server.rconPort));
				});

				it("preserves an explicitly configured port even if occupied", async function() {
					makeServer({ rconPort: held.address().port });
					await server[method]("unused");
					assert.equal(server.rconPort, held.address().port);
					assert.equal(args[args.indexOf("--rcon-port") + 1], String(held.address().port));
				});

				it("releases its port claim if preparing the process throws", async function() {
					makeServer({});
					// eslint-disable-next-line node/no-sync -- Stub the synchronous config writer.
					server._writeConfigIniSync = () => { throw new Error("preparation failed"); };
					await assert.rejects(server[method]("unused"), /preparation failed/);
					assert.equal(server._releaseRconPort, undefined);
					assert.equal(server._state, "init");
				});

				it("releases its port claim on process failure", async function() {
					makeServer({});
					server.on("error", () => {});
					await server[method]("unused");
					let released = false;
					const release = server._releaseRconPort;
					server._releaseRconPort = () => { released = true; release(); };
					server._server.emit("error", Object.assign(new Error("spawn failed"), { code: "EACCES" }));
					assert(released, "Port claim survived a failed spawn");
					assert.equal(server._releaseRconPort, undefined);
					assert.equal(server._state, "init");
				});
			});
		}
	});
});
