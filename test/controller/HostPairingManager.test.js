import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";
import { Controller, HostPairingManager, HostPairingError, HostRecord } from "@clusterio/controller";
import {
	pollTimeoutMs, maxPendingPerAddress, maxNameLength,
} from "@clusterio/controller/dist/node/src/HostPairingManager.js";

import "../setup_logging.js";

const codePattern = /^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$/;

function makeController() {
	const config = new lib.ControllerConfig("controller");
	config.set("controller.auth_secret", Buffer.from("TestSecretDoNotUse").toString("base64"));
	return new Controller(lib.logger, [], config);
}

/**
 * Make crypto.randomInt return the given values before falling back to random ones
 *
 * @param {number[]} values - Values to return, in order.
 * @returns {() => void} function restoring crypto.randomInt.
 */
function stubRandomInt(values) {
	const original = crypto.randomInt;
	crypto.randomInt = (...args) => (values.length ? values.shift() : original(...args));
	return () => { crypto.randomInt = original; };
}

function assertPairingError(fn, status, message) {
	assert.throws(fn, err => {
		assert(err instanceof HostPairingError, `expected HostPairingError, got ${err}`);
		assert.equal(err.status, status);
		if (message) {
			assert.equal(err.message, message);
		}
		return true;
	});
}

describe("controller/src/HostPairingManager", function() {

	describe("HostPairingManager.validateName()", function() {
		it("should require a non-empty string", function() {
			for (const name of [undefined, null, 5, {}, "", "   "]) {
				assertPairingError(() => HostPairingManager.validateName(name), 400, "Host name is required");
			}
		});
		it("should trim the name", function() {
			assert.equal(HostPairingManager.validateName("  Host A \t"), "Host A");
		});
		it("should limit the length of the name", function() {
			const longest = "x".repeat(maxNameLength);
			assert.equal(maxNameLength, 100);
			assert.equal(HostPairingManager.validateName(longest), longest);
			assert.equal(HostPairingManager.validateName(` ${longest} `), longest);
			assertPairingError(
				() => HostPairingManager.validateName(`${longest}x`),
				400, "Host name must be at most 100 characters",
			);
		});
		it("should refuse control and bidirectional override characters", function() {
			for (const name of ["x\u001b]0;title\u0007", "line\nfaked", "a\rb", "del\u007f", "c1\u009b", "x\u202ey"]) {
				assertPairingError(
					() => HostPairingManager.validateName(name), 400, "Host name may not contain control characters",
				);
			}
		});
		it("should allow other unicode characters", function() {
			for (const name of ["Fabrikk p\u00e5 \u00d8stlandet", "\u5de5\u5382 1", "box \u{1F44D}\u200d"]) {
				assert.equal(HostPairingManager.validateName(name), name);
			}
		});
	});

	describe("class HostPairingManager", function() {
		/** @type {Controller} */
		let controller;
		/** @type {HostPairingManager} */
		let manager;
		let updates;
		let restoreRandomInt;

		beforeEach(function() {
			controller = makeController();
			manager = controller.hostPairing;
			updates = [];
			manager.records.on("update", changed => {
				updates.push(...changed.map(details => ({ code: details.code, isDeleted: details.isDeleted })));
			});
			restoreRandomInt = undefined;
		});
		afterEach(function() {
			manager.stop();
			if (restoreRandomInt) {
				restoreRandomInt();
			}
		});

		function internal(requestId) {
			return manager._bySecret.get(requestId);
		}

		// Pretend the host last polled the request ms milliseconds earlier.
		function idle(requestId, ms) {
			internal(requestId).lastPollMs -= ms;
		}

		describe(".createHost()", function() {
			it("should create a host record with a valid token", function() {
				const before = Math.floor(Date.now() / 1000);
				const result = manager.createHost("Host A");

				assert.equal(result.name, "Host A");
				assert(Number.isInteger(result.hostId), "hostId is not an integer");
				assert(result.hostId >= 1 && result.hostId < 2 ** 31, `hostId ${result.hostId} out of range`);

				const record = controller.hosts.get(result.hostId);
				assert(record instanceof HostRecord, "host record was not created");
				assert.equal(record.name, "Host A");
				assert.equal(record.connected, false);
				assert(record.tokenValidAfter >= before, "tokenValidAfter predates the call");
				assert(record.tokenValidAfter <= Math.floor(Date.now() / 1000), "tokenValidAfter is in the future");

				const payload = jwt.verify(result.token, controller.authSecret, { audience: "host" });
				assert.equal(payload.host, result.hostId);
				assert(payload.iat >= record.tokenValidAfter, "token is not valid for the new record");
			});
			it("should not reuse the id of an existing host", function() {
				controller.hosts.set(new HostRecord(5, "existing", "", new Map()));
				restoreRandomInt = stubRandomInt([5, 5, 6]);
				const result = manager.createHost("Host A");
				assert.equal(result.hostId, 6);
				assert.equal(controller.hosts.get(5).name, "existing");
				assert.equal(controller.hosts.get(6).name, "Host A");
			});
		});

		describe(".create()", function() {
			it("should create a pending request", function() {
				const before = Date.now();
				const { requestId, code } = manager.create("Host A", "2.0.0", "10.0.0.1");

				assert.equal(typeof requestId, "string");
				assert(requestId.length >= 32, "requestId is too short to be a secret");
				assert.match(code, codePattern);
				assert.notEqual(requestId, code);

				const details = manager.records.get(code);
				assert(details instanceof lib.HostPairingDetails);
				assert.equal(details.code, code);
				assert.equal(details.name, "Host A");
				assert.equal(details.version, "2.0.0");
				assert.equal(details.remoteAddress, "10.0.0.1");
				assert(details.createdAtMs >= before && details.createdAtMs <= Date.now());
				assert(details.updatedAtMs > 0);
				assert.equal(details.isDeleted, false);
				assert(!JSON.stringify(details).includes(requestId), "requestId is exposed to users");
				assert.deepEqual(updates, [{ code, isDeleted: false }]);
			});
			it("should create unique codes", function() {
				const codes = new Set();
				for (let i = 0; i < 50; i++) {
					const { code } = manager.create(`Host ${i}`, "", `10.1.${i}.1`);
					assert.match(code, codePattern);
					codes.add(code);
				}
				assert.equal(codes.size, 50);
			});
			it("should not reuse the code of a pending request", function() {
				restoreRandomInt = stubRandomInt([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
				assert.equal(manager.create("Host A", "", "10.0.0.1").code, "222-222");
				assert.equal(manager.create("Host B", "", "10.0.0.2").code, "333-333");
			});
			it("should not reuse the code of an approved request not yet picked up", function() {
				restoreRandomInt = stubRandomInt([0, 0, 0, 0, 0, 0, 1234, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
				const { code } = manager.create("Host A", "", "10.0.0.1");
				assert.equal(code, "222-222");
				assert.equal(manager.approve(code, undefined, "admin"), 1234);
				assert.equal(manager.create("Host B", "", "10.0.0.2").code, "333-333");
			});
		});

		describe("limits", function() {
			it("should limit pending requests per address", function() {
				assert.equal(maxPendingPerAddress, 3);
				for (let i = 0; i < maxPendingPerAddress; i++) {
					manager.create("Host", "", "10.0.0.1");
				}
				assert.throws(() => manager.create("Host", "", "10.0.0.1"), err => {
					assert(err instanceof HostPairingError);
					assert.equal(err.status, 429);
					assert.equal(err.retryAfter, 30);
					assert.equal(err.message, "Too many pending requests from this address");
					return true;
				});
				// Other addresses are not affected
				manager.create("Host", "", "10.0.0.2");
				assert.equal(manager.records.size, maxPendingPerAddress + 1);
			});
			it("should count IPv4 mapped addresses as the IPv4 address", function() {
				manager.create("Host", "", "10.0.0.1");
				manager.create("Host", "", "::ffff:10.0.0.1");
				manager.create("Host", "", "10.0.0.1");
				assertPairingError(() => manager.create("Host", "", "::ffff:10.0.0.1"), 429);
			});
			it("should group IPv6 addresses by /64", function() {
				manager.create("Host", "", "2001:db8:0:1::1");
				manager.create("Host", "", "2001:db8:0:1::2");
				manager.create("Host", "", "2001:db8::1:ffff:0:0:3");
				assertPairingError(
					() => manager.create("Host", "", "2001:0db8:0000:0001:0000:0000:0000:0004"),
					429, "Too many pending requests from this address",
				);
				manager.create("Host", "", "2001:db8:0:2::1");
			});
			it("should free the slot when a request is no longer pending", function() {
				const first = manager.create("Host", "", "10.0.0.1");
				const second = manager.create("Host", "", "10.0.0.1");
				const third = manager.create("Host", "", "10.0.0.1");
				assertPairingError(() => manager.create("Host", "", "10.0.0.1"), 429);

				manager.cancel(first.requestId);
				const fourth = manager.create("Host", "", "10.0.0.1");
				assertPairingError(() => manager.create("Host", "", "10.0.0.1"), 429);

				// Approved and rejected results waiting to be picked up do not count
				manager.approve(second.code, undefined, "admin");
				manager.reject(third.code, "admin");
				manager.create("Host", "", "10.0.0.1");
				manager.create("Host", "", "10.0.0.1");
				assertPairingError(() => manager.create("Host", "", "10.0.0.1"), 429);
				assert(manager.records.has(fourth.code));
			});
			it("should limit the total number of pending requests", function() {
				const maxPending = controller.config.get("controller.host_pairing_max_pending");
				assert.equal(maxPending, 50);
				for (let i = 0; i < maxPending; i++) {
					manager.create(`Host ${i}`, "", `10.1.${i}.1`);
				}
				assert.throws(() => manager.create("Host", "", "10.2.0.1"), err => {
					assert(err instanceof HostPairingError);
					assert.equal(err.status, 429);
					assert.equal(err.retryAfter, 30);
					assert.equal(err.message, "Too many pending requests");
					return true;
				});
				assert.equal(manager.records.size, maxPending);
			});
			it("should not limit the total number of pending requests when set to 0", function() {
				controller.config.set("controller.host_pairing_max_pending", 0);
				for (let i = 0; i < 60; i++) {
					manager.create(`Host ${i}`, "", `10.1.${i}.1`);
				}
				assert.equal(manager.records.size, 60);
			});
		});

		describe(".poll()", function() {
			it("should return null while pending", function() {
				const { requestId } = manager.create("Host A", "", "10.0.0.1");
				assert.equal(manager.poll(requestId), null);
				assert.equal(manager.poll(requestId), null);
			});
			it("should throw 404 for an unknown request", function() {
				assertPairingError(() => manager.poll("invalid"), 404, "Request not found");
			});
			it("should not accept the code in place of the request id", function() {
				const { code } = manager.create("Host A", "", "10.0.0.1");
				assertPairingError(() => manager.poll(code), 404);
			});
			it("should hand over an approved result once", function() {
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				const hostId = manager.approve(code, undefined, "admin");
				const result = manager.poll(requestId);
				assert.deepEqual(Object.keys(result).sort(), ["hostId", "name", "token"]);
				assert.equal(result.hostId, hostId);
				assert.equal(result.name, "Host A");
				const payload = jwt.verify(result.token, controller.authSecret, { audience: "host" });
				assert.equal(payload.host, hostId);

				assertPairingError(() => manager.poll(requestId), 404, "Request not found");
				assert.equal(manager._byCode.has(code), false);
			});
			it("should report a rejection once", function() {
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				manager.reject(code, "admin");
				assertPairingError(() => manager.poll(requestId), 403, "Request was rejected");
				assertPairingError(() => manager.poll(requestId), 404, "Request not found");
			});
		});

		describe(".cancel()", function() {
			it("should remove a pending request", function() {
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				manager.cancel(requestId);
				assert.equal(manager.records.has(code), false);
				assertPairingError(() => manager.poll(requestId), 404);
				assert.deepEqual(updates, [{ code, isDeleted: false }, { code, isDeleted: true }]);
				assert.throws(() => manager.reject(code, "admin"), lib.NotFoundError);
			});
			it("should ignore unknown requests", function() {
				manager.cancel("invalid");
			});
			it("should not throw away an approved result", function() {
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				const hostId = manager.approve(code, undefined, "admin");
				manager.cancel(requestId);
				assert.equal(manager.poll(requestId).hostId, hostId);
			});
			it("should not throw away a rejection", function() {
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				manager.reject(code, "admin");
				manager.cancel(requestId);
				assertPairingError(() => manager.poll(requestId), 403);
			});
		});

		describe(".approve()", function() {
			it("should create the host with the requested name", function() {
				const { code } = manager.create("Host A", "", "10.0.0.1");
				const hostId = manager.approve(code, undefined, "admin");
				assert.equal(controller.hosts.get(hostId).name, "Host A");
				assert.equal(manager.records.has(code), false);
				assert.deepEqual(updates, [{ code, isDeleted: false }, { code, isDeleted: true }]);
			});
			it("should accept codes in any case and without the dash", function() {
				const { code } = manager.create("Host A", "", "10.0.0.1");
				const hostId = manager.approve(code.toLowerCase().replace("-", ""), undefined, "admin");
				assert(controller.hosts.has(hostId));
			});
			it("should use and trim the name given", function() {
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				const hostId = manager.approve(code, "  Renamed ", "admin");
				assert.equal(controller.hosts.get(hostId).name, "Renamed");
				assert.equal(manager.poll(requestId).name, "Renamed");
			});
			it("should reject an invalid name and keep the request pending", function() {
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				assert.throws(
					() => manager.approve(code, "", "admin"),
					new lib.ValidationError("Host name is required"),
				);
				assert.throws(
					() => manager.approve(code, "x".repeat(maxNameLength + 1), "admin"),
					new lib.ValidationError("Host name must be at most 100 characters"),
				);
				assert.equal(controller.hosts.size, 0);
				assert.equal(manager.poll(requestId), null);
				manager.approve(code, undefined, "admin");
				assert.equal(controller.hosts.size, 1);
			});
			it("should throw NotFoundError for an unknown code", function() {
				assert.throws(
					() => manager.approve("ZZZ-ZZZ", undefined, "admin"),
					new lib.NotFoundError("No pending host request with code ZZZ-ZZZ"),
				);
			});
			it("should only approve a request once", function() {
				const { code } = manager.create("Host A", "", "10.0.0.1");
				manager.approve(code, undefined, "admin");
				assert.throws(() => manager.approve(code, undefined, "admin"), lib.NotFoundError);
				assert.equal(controller.hosts.size, 1);
			});
		});

		describe(".reject()", function() {
			it("should remove the request from the pending list", function() {
				const { code } = manager.create("Host A", "", "10.0.0.1");
				manager.reject(code.toLowerCase(), "admin");
				assert.equal(manager.records.has(code), false);
				assert.deepEqual(updates, [{ code, isDeleted: false }, { code, isDeleted: true }]);
				assert.equal(controller.hosts.size, 0);
			});
			it("should throw NotFoundError for an unknown code", function() {
				assert.throws(
					() => manager.reject("ZZZ-ZZZ", "admin"),
					new lib.NotFoundError("No pending host request with code ZZZ-ZZZ"),
				);
			});
			it("should not reject an approved request", function() {
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				const hostId = manager.approve(code, undefined, "admin");
				assert.throws(() => manager.reject(code, "admin"), lib.NotFoundError);
				assert.equal(manager.poll(requestId).hostId, hostId);
			});
		});

		describe(".prune()", function() {
			let warnings;
			let originalWarn;
			beforeEach(function() {
				warnings = [];
				originalWarn = lib.logger.warn;
				lib.logger.warn = msg => { warnings.push(msg); };
			});
			afterEach(function() {
				lib.logger.warn = originalWarn;
			});

			it("should expire a request the host stopped polling", function() {
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				idle(requestId, pollTimeoutMs + 1);
				manager.prune();
				assert.equal(manager.records.has(code), false);
				assert.deepEqual(updates, [{ code, isDeleted: false }, { code, isDeleted: true }]);
				assertPairingError(() => manager.poll(requestId), 404);
				assert.throws(() => manager.reject(code, "admin"), lib.NotFoundError);
			});
			it("should keep a request that is still polled", function() {
				assert.equal(pollTimeoutMs, 30e3);
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				idle(requestId, pollTimeoutMs - 1000);
				manager.prune();
				assert.equal(manager.poll(requestId), null);
				idle(requestId, pollTimeoutMs - 1000);
				manager.prune();
				assert(manager.records.has(code));
			});
			it("should expire a request that has been pending for too long", function() {
				const timeoutMs = controller.config.get("controller.host_pairing_timeout") * 1000;
				assert.equal(timeoutMs, 60 * 60e3);
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				internal(requestId).details.createdAtMs -= timeoutMs - 1000;
				manager.prune();
				assert.equal(manager.poll(requestId), null);
				internal(requestId).details.createdAtMs -= 1001;
				manager.prune();
				assert.equal(manager.records.has(code), false);
				assertPairingError(() => manager.poll(requestId), 404);
			});
			it("should not limit how long a request is pending when the timeout is 0", function() {
				controller.config.set("controller.host_pairing_timeout", 0);
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				internal(requestId).details.createdAtMs -= 365 * 24 * 60 * 60e3;
				manager.prune();
				assert(manager.records.has(code));
				assert.equal(manager.poll(requestId), null);
			});
			it("should drop and warn about an approved host never picked up", function() {
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				const hostId = manager.approve(code, undefined, "admin");
				idle(requestId, pollTimeoutMs + 1);
				manager.prune();
				assertPairingError(() => manager.poll(requestId), 404);
				assert.equal(warnings.length, 1);
				assert.match(warnings[0], new RegExp(`Approved host Host A \\(${hostId}\\) was never picked up`));
				// The host stays until revoked
				assert(controller.hosts.has(hostId));
			});
			it("should drop a rejection never picked up", function() {
				const { requestId, code } = manager.create("Host A", "", "10.0.0.1");
				manager.reject(code, "admin");
				idle(requestId, pollTimeoutMs + 1);
				manager.prune();
				assertPairingError(() => manager.poll(requestId), 404);
				assert.equal(warnings.length, 0);
			});
		});

		describe("Controller integration", function() {
			it("should broadcast changes to pending requests", function() {
				const broadcasts = [];
				controller.subscriptions.broadcast = event => {
					if (event instanceof lib.HostPairingUpdatesEvent) {
						broadcasts.push(event.updates.map(details => [details.code, details.isDeleted]));
					}
				};
				const { code } = manager.create("Host A", "", "10.0.0.1");
				manager.reject(code, "admin");
				assert.deepEqual(broadcasts, [[[code, false]], [[code, true]]]);
			});
			it("should send pending requests to new subscribers", async function() {
				const { code } = manager.create("Host A", "", "10.0.0.1");
				const event = await controller.handleHostPairingSubscription(
					new lib.SubscriptionRequest(lib.HostPairingUpdatesEvent.name, true, 0)
				);
				assert(event instanceof lib.HostPairingUpdatesEvent);
				assert.deepEqual(event.updates.map(details => details.code), [code]);

				const lastUpdate = manager.records.get(code).updatedAtMs;
				assert.equal(await controller.handleHostPairingSubscription(
					new lib.SubscriptionRequest(lib.HostPairingUpdatesEvent.name, true, lastUpdate)
				), null);
			});
		});
	});
});
