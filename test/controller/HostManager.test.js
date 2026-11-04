import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";
import { Controller, HostManager, HostRecord } from "@clusterio/controller";

import "../setup_logging.js";

describe("controller/src/HostManager", function() {
	/** @type {Controller} */
	let controller;
	/** @type {HostManager} */
	let hosts;

	beforeEach(function() {
		const config = new lib.ControllerConfig("controller");
		config.set("controller.auth_secret", Buffer.from("TestSecretDoNotUse").toString("base64"));
		controller = new Controller(lib.logger, [], config);
		hosts = controller.hosts;
	});

	it("should be the host manager of the controller", function() {
		assert(hosts instanceof HostManager);
	});

	describe(".has() / .get() / .getMutable() / .values() / .getForRequest()", function() {
		it("should return the host when it exists", function() {
			const record = new HostRecord(5, "five", "", new Map());
			hosts.records.set(record);
			assert.equal(hosts.has(5), true);
			assert.equal(hosts.get(5), record);
			assert.equal(hosts.getMutable(5), record);
			assert.deepEqual([...hosts.values()], [record]);
			assert.equal(hosts.getForRequest(5), record);
		});
		it("should return undefined or throw when the host does not exist", function() {
			assert.equal(hosts.has(5), false);
			assert.equal(hosts.get(5), undefined);
			assert.equal(hosts.getMutable(5), undefined);
			assert.throws(() => hosts.getForRequest(5), new lib.NotFoundError("Unknown host id (5)"));
		});
	});

	describe(".createHost()", function() {
		let originalRandomInt;
		afterEach(function() {
			if (originalRandomInt) {
				crypto.randomInt = originalRandomInt;
				originalRandomInt = undefined;
			}
		});

		it("should create a host record that its tokens are valid for", function() {
			const before = Math.floor(Date.now() / 1000);
			const host = hosts.createHost("Host A");

			assert(host instanceof HostRecord);
			assert(Number.isInteger(host.id), "id is not an integer");
			assert(host.id >= 1 && host.id < 2 ** 31, `id ${host.id} out of range`);
			assert.equal(hosts.get(host.id), host);
			assert.equal(host.name, "Host A");
			assert.equal(host.connected, false);
			assert(host.tokenValidAfter >= before, "tokenValidAfter predates the call");
			assert(host.tokenValidAfter <= Math.floor(Date.now() / 1000), "tokenValidAfter is in the future");
			assert.equal(hosts.verifyHostToken(hosts.signHostToken(host.id)), host);
		});
		it("should not reuse the id of an existing host", function() {
			hosts.records.set(new HostRecord(5, "existing", "", new Map()));
			const values = [5, 5, 6];
			originalRandomInt = crypto.randomInt;
			crypto.randomInt = (...args) => (values.length ? values.shift() : originalRandomInt(...args));
			const host = hosts.createHost("Host A");
			assert.equal(host.id, 6);
			assert.equal(hosts.get(5).name, "existing");
			assert.equal(hosts.get(6).name, "Host A");
		});
	});

	describe(".signHostToken()", function() {
		it("should return a host token for the id", function() {
			const payload = jwt.verify(hosts.signHostToken(5), controller.authSecret);
			const { iat, ...rest } = payload;
			assert.equal(typeof iat, "number");
			assert.deepEqual(rest, { aud: "host", host: 5 });
		});
	});

	describe(".verifyHostToken()", function() {
		beforeEach(function() {
			hosts.records.set(new HostRecord(5, "five", "", new Map()));
		});

		it("should return the mutable host record", function() {
			assert.equal(hosts.verifyHostToken(hosts.signHostToken(5)), hosts.getMutable(5));
		});
		it("should accept a token from before the slave rename", function() {
			const token = jwt.sign({ aud: "slave", slave: 5 }, controller.authSecret);
			assert.equal(hosts.verifyHostToken(token).id, 5);
		});
		it("should reject a token for an unknown host", function() {
			assert.throws(() => hosts.verifyHostToken(hosts.signHostToken(6)), /host is not registered/);
		});
		it("should reject a token issued before tokenValidAfter", function() {
			const now = Math.floor(Date.now() / 1000);
			hosts.getMutable(5).tokenValidAfter = now;
			const token = jwt.sign({ aud: "host", host: 5, iat: now - 1 }, controller.authSecret);
			assert.throws(() => hosts.verifyHostToken(token), new Error("invalid token"));
		});
		it("should reject user tokens and bad signatures", function() {
			const userToken = jwt.sign({ aud: "user", user: "test" }, controller.authSecret);
			assert.throws(() => hosts.verifyHostToken(userToken), /audience invalid/);
			const forged = jwt.sign({ aud: "host", host: 5 }, "wrong secret");
			assert.throws(() => hosts.verifyHostToken(forged), /invalid signature/);
		});
	});

	describe(".revokeHost()", function() {
		it("should throw for an unknown host", async function() {
			await assert.rejects(hosts.revokeHost(5, "admin"), new lib.NotFoundError("Unknown host id (5)"));
		});
	});
});
