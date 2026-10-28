import assert from "node:assert/strict";
import crypto from "node:crypto";
import events from "node:events";
import http from "node:http";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";
import { Controller, ControlConnection, HostRecord } from "@clusterio/controller";
import * as routes from "@clusterio/controller/dist/node/src/routes.js";

import { testRoundTripJsonSerialisable } from "../common.js";
import "../setup_logging.js";

describe("messages/host_invite", function() {
	/** @type {Controller} */
	let controller;
	/** @type {ControlConnection} */
	let controlConnection;
	let broadcasts;

	beforeEach(function() {
		const controllerConfig = new lib.ControllerConfig("controller");
		controllerConfig.set("controller.auth_secret", Buffer.from("test-secret").toString("base64"));
		const connection = new lib.VirtualConnector(
			lib.Address.fromShorthand("controller"),
			lib.Address.fromShorthand({ controlId: 1 }),
		);
		controller = new Controller(lib.logger, [], controllerConfig);
		broadcasts = [];
		controller.subscriptions.broadcast = event => {
			if (event instanceof lib.HostInviteUpdatesEvent) {
				broadcasts.push(event);
			}
		};
		const user = controller.users.getOrCreateUser("test");
		controlConnection = new ControlConnection({ version: "2.0.0" }, connection, controller, user, 1);
	});

	function hostIdOf(token) {
		return jwt.verify(token, controller.authSecret, { audience: "host" }).host;
	}

	describe("round trips", function() {
		it("HostInviteCreateRequest", function() {
			testRoundTripJsonSerialisable(lib.HostInviteCreateRequest, [[null, null], [1234, 3]]);
		});
		it("HostInviteUpdateRequest", function() {
			testRoundTripJsonSerialisable(lib.HostInviteUpdateRequest, [[1], [1, null, null], [1, 1234, 2]]);
		});
		it("HostInviteRevokeRequest", function() {
			testRoundTripJsonSerialisable(lib.HostInviteRevokeRequest, [[1]]);
		});
		it("HostInviteUpdatesEvent", function() {
			testRoundTripJsonSerialisable(lib.HostInviteUpdatesEvent, [[[new lib.HostInvite(1, "ABCD2345")]]]);
		});
	});

	describe("HostInviteCreateRequest", function() {
		it("creates an invite attributed to the requesting user", async function() {
			const expiresAtMs = Date.now() + 60e3;
			const response = await controlConnection.handleHostInviteCreateRequest(
				new lib.HostInviteCreateRequest(expiresAtMs, 2)
			);
			const invite = controller.hostInvites.get(response.invite.id);
			assert.equal(invite.createdBy, "test");
			assert.equal(invite.expiresAtMs, expiresAtMs);
			assert.equal(invite.maxUses, 2);
			assert.equal(invite.uses, 0);
			assert.match(invite.code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
			assert.equal(response.url, `http://localhost:8080/invite/${invite.code}`);
			assert.equal(broadcasts.length, 1);
		});
		it("rejects an expiry time in the past", async function() {
			await assert.rejects(
				controlConnection.handleHostInviteCreateRequest(new lib.HostInviteCreateRequest(Date.now() - 1, null)),
				new lib.InvalidValueError("Expiry time must be in the future"),
			);
		});
		it("generates codes from the whole alphabet", function() {
			const seen = new Set();
			for (let i = 0; i < 200; i++) {
				for (const char of Controller.generateHostInviteCode()) {
					seen.add(char);
				}
			}
			assert.equal(seen.size, lib.HostInvite.codeAlphabet.length);
		});
	});

	describe("HostInviteUpdateRequest", function() {
		it("changes only the given limits", async function() {
			const invite = controller.createHostInvite(Date.now() + 60e3, 1, "test");
			await controlConnection.handleHostInviteUpdateRequest(new lib.HostInviteUpdateRequest(invite.id, null));
			assert.equal(controller.hostInvites.get(invite.id).expiresAtMs, null);
			assert.equal(controller.hostInvites.get(invite.id).maxUses, 1);
			await controlConnection.handleHostInviteUpdateRequest(
				new lib.HostInviteUpdateRequest(invite.id, undefined, 5)
			);
			assert.equal(controller.hostInvites.get(invite.id).expiresAtMs, null);
			assert.equal(controller.hostInvites.get(invite.id).maxUses, 5);
		});
		it("extends a used up invite", async function() {
			const invite = controller.createHostInvite(null, 1, "test");
			assert(controller.claimHostInvite(invite.code));
			assert.equal(controller.claimHostInvite(invite.code), null);
			await controlConnection.handleHostInviteUpdateRequest(
				new lib.HostInviteUpdateRequest(invite.id, undefined, 2)
			);
			assert(controller.claimHostInvite(invite.code));
		});
		it("fails for an unknown invite", async function() {
			await assert.rejects(
				controlConnection.handleHostInviteUpdateRequest(new lib.HostInviteUpdateRequest(1, null)),
				new lib.NotFoundError("Host invite 1 does not exist"),
			);
		});
	});

	describe("HostInviteRevokeRequest", function() {
		it("removes the invite", async function() {
			const invite = controller.createHostInvite(null, null, "test");
			await controlConnection.handleHostInviteRevokeRequest(new lib.HostInviteRevokeRequest(invite.id));
			assert.equal(controller.hostInvites.has(invite.id), false);
			assert.equal(controller.claimHostInvite(invite.code), null);
			assert.equal(broadcasts.at(-1).updates[0].isDeleted, true);
		});
	});

	describe("HostInviteListRequest", function() {
		it("lists all invites", async function() {
			controller.createHostInvite(null, null, "test");
			controller.createHostInvite(null, 1, "test");
			const invites = await controlConnection.handleHostInviteListRequest();
			assert.equal(invites.length, 2);
		});
	});

	describe("Controller.claimHostInvite()", function() {
		it("issues a token for a new host id and counts the use", function() {
			const invite = controller.createHostInvite(null, 2, "test");
			const first = controller.claimHostInvite(invite.code);
			const second = controller.claimHostInvite(invite.code);
			assert.equal(hostIdOf(first.token), first.hostId);
			assert.equal(hostIdOf(second.token), second.hostId);
			assert.notEqual(first.hostId, second.hostId);
			assert.deepEqual(controller.hostInvites.get(invite.id).hostIds, [first.hostId, second.hostId]);
			assert.equal(controller.claimHostInvite(invite.code), null);
		});
		it("refuses expired invites", function() {
			const invite = controller.createHostInvite(Date.now() + 60e3, null, "test");
			controller.hostInvites.getMutable(invite.id).expiresAtMs = Date.now() - 1;
			assert.equal(controller.claimHostInvite(invite.code), null);
		});
		it("refuses unknown codes", function() {
			controller.createHostInvite(null, null, "test");
			assert.equal(controller.claimHostInvite("ZZZZZZZZ"), null);
		});
		it("avoids ids of existing hosts and earlier claims", function() {
			const invite = controller.createHostInvite(null, null, "test");
			controller.hosts.set(new HostRecord(5, "existing", "2.0.0", new Map()));
			const original = crypto.randomInt;
			const ids = [5, 6, 5, 6, 7];
			crypto.randomInt = () => ids.shift();
			try {
				assert.equal(controller.claimHostInvite(invite.code).hostId, 6);
				assert.equal(controller.claimHostInvite(invite.code).hostId, 7);
			} finally {
				crypto.randomInt = original;
			}
		});
	});

	describe("Controller.pruneHostInvites()", function() {
		it("removes invites a week after they stopped being usable", function() {
			const now = Date.now();
			const active = controller.createHostInvite(null, null, "test");
			const expired = controller.createHostInvite(now + 1000, null, "test");
			const usedUp = controller.createHostInvite(null, 1, "test");
			controller.claimHostInvite(usedUp.code);
			controller.pruneHostInvites(now + 6 * 86400e3);
			assert.equal(controller.hostInvites.size, 3);
			controller.pruneHostInvites(now + 1000 + 7 * 86400e3);
			assert.equal(controller.hostInvites.has(expired.id), false);
			assert.equal(controller.hostInvites.has(usedUp.id), false);
			assert.equal(controller.hostInvites.has(active.id), true);
		});
	});

	describe("Controller.redactInviteUrl()", function() {
		it("masks the invite code in a path", function() {
			assert.equal(Controller.redactInviteUrl("/invite/ABCD2345"), "/invite/AB******");
			assert.equal(Controller.redactInviteUrl("/sub/invite/ABCD2345?x=y"), "/sub/invite/AB******?x=y");
			assert.equal(Controller.redactInviteUrl("/api/plugins"), "/api/plugins");
		});
	});

	describe("/invite/:code", function() {
		let server;
		let endpoint;
		beforeEach(async function() {
			routes.addRouteHandlers(controller.app);
			server = http.createServer(controller.app);
			server.listen(0, "localhost");
			await events.once(server, "listening");
			endpoint = `http://localhost:${server.address().port}/invite`;
		});
		afterEach(function() {
			server.close();
		});

		it("checks an invite without using it", async function() {
			const invite = controller.createHostInvite(null, 3, "test");
			const response = await fetch(`${endpoint}/${invite.code.toLowerCase()}`);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("cache-control"), "no-store");
			assert.deepEqual(await response.json(), { expiresAtMs: null, usesLeft: 3 });
			assert.equal(controller.hostInvites.get(invite.id).uses, 0);
		});
		it("claims an invite with POST", async function() {
			const invite = controller.createHostInvite(null, 1, "test");
			const response = await fetch(`${endpoint}/${invite.code}`, { method: "POST" });
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("cache-control"), "no-store");
			const { hostId, token } = await response.json();
			assert.equal(hostIdOf(token), hostId);
			const again = await fetch(`${endpoint}/${invite.code}`, { method: "POST" });
			assert.equal(again.status, 404);
		});
		it("responds the same for unknown, malformed, expired and used up invites", async function() {
			const expired = controller.createHostInvite(Date.now() + 60e3, null, "test");
			controller.hostInvites.getMutable(expired.id).expiresAtMs = Date.now() - 1;
			const usedUp = controller.createHostInvite(null, 1, "test");
			controller.claimHostInvite(usedUp.code);
			const bodies = new Set();
			for (const code of ["ZZZZZZZZ", "not-a-code", expired.code, usedUp.code]) {
				for (const method of ["GET", "POST"]) {
					const response = await fetch(`${endpoint}/${code}`, { method });
					assert.equal(response.status, 404, `${method} ${code}`);
					bodies.add(await response.text());
				}
			}
			assert.equal(bodies.size, 1);
		});
		it("lets only one of many concurrent claims use a single use invite", async function() {
			const invite = controller.createHostInvite(null, 1, "test");
			const responses = await Promise.all(
				Array.from({ length: 8 }, () => fetch(`${endpoint}/${invite.code}`, { method: "POST" }))
			);
			const statuses = responses.map(r => r.status).sort();
			assert.deepEqual(statuses, [200, 404, 404, 404, 404, 404, 404, 404]);
			assert.equal(controller.hostInvites.get(invite.id).uses, 1);
		});
		it("blocks an address after 10 invalid attempts, even with a valid code", async function() {
			const invite = controller.createHostInvite(null, null, "test");
			for (let i = 0; i < 10; i++) {
				const response = await fetch(`${endpoint}/ZZZZZZZZ`, { method: "POST" });
				assert.equal(response.status, 404);
			}
			const blocked = await fetch(`${endpoint}/${invite.code}`, { method: "POST" });
			assert.equal(blocked.status, 429);
			assert(Number(blocked.headers.get("retry-after")) > 0);
			assert.equal(controller.hostInvites.get(invite.id).uses, 0);
		});
		it("does not count successful claims as failures", async function() {
			const invite = controller.createHostInvite(null, null, "test");
			for (let i = 0; i < 12; i++) {
				const response = await fetch(`${endpoint}/${invite.code}`, { method: "POST" });
				assert.equal(response.status, 200);
			}
		});
	});
});
