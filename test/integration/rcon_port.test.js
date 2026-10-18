import assert from "node:assert/strict";
import net from "node:net";
import events from "node:events";

import { getTestRconPort } from "./rcon_port.js";

describe("test/integration/rcon_port.js", function() {
	describe("getTestRconPort()", function() {
		it("gives concurrent fixtures distinct ports and closes its probes", async function() {
			const ports = await Promise.all(Array.from({ length: 16 }, () => getTestRconPort()));
			assert.equal(new Set(ports).size, ports.length);
			for (const port of ports) {
				assert(port >= 20000 && port < 30000);
				const probe = net.createServer();
				try {
					const listening = events.once(probe, "listening");
					probe.listen(port, "0.0.0.0");
					await listening;
				} finally {
					if (probe.listening) {
						await new Promise(resolve => probe.close(resolve));
					}
				}
			}
		});

		it("skips an occupied candidate", async function() {
			const original = net.Server.prototype.listen;
			let occupied;
			net.Server.prototype.listen = function(options, callback) {
				if (occupied === undefined) {
					occupied = options.port;
					queueMicrotask(() => this.emit("error", Object.assign(new Error("occupied"), {
						code: "EADDRINUSE",
					})));
					return this;
				}
				return original.call(this, options, callback);
			};
			try {
				assert.notEqual(await getTestRconPort(), occupied);
			} finally {
				net.Server.prototype.listen = original;
			}
		});

		it("falls back to IPv4 when IPv6 is unavailable", async function() {
			const original = net.Server.prototype.listen;
			const hosts = [];
			net.Server.prototype.listen = function(options, callback) {
				hosts.push(options.host);
				if (options.host === "::") {
					queueMicrotask(() => this.emit("error", Object.assign(new Error("IPv6 disabled"), {
						code: "EAFNOSUPPORT",
					})));
					return this;
				}
				return original.call(this, options, callback);
			};
			try {
				await getTestRconPort();
				assert.deepEqual(hosts, ["::", "0.0.0.0"]);
			} finally {
				net.Server.prototype.listen = original;
			}
		});

		it("propagates permission errors", async function() {
			const original = net.Server.prototype.listen;
			const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
			let calls = 0;
			net.Server.prototype.listen = function() {
				calls += 1;
				queueMicrotask(() => this.emit("error", error));
				return this;
			};
			try {
				await assert.rejects(getTestRconPort(), err => err === error);
				assert.equal(calls, 1);
			} finally {
				net.Server.prototype.listen = original;
			}
		});
	});
});
