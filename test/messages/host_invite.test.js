import assert from "node:assert/strict";
import crypto from "node:crypto";
import events from "node:events";
import http from "node:http";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";
import { Controller, ControlConnection, HostManager, HostRecord } from "@clusterio/controller";
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
			testRoundTripJsonSerialisable(
				lib.HostInviteUpdateRequest, [[1], [1, null, null], [1, 1234, 2], [1, undefined, undefined, true]]
			);
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
			const invite = controller.hosts.invites.get(response.invite.id);
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
				for (const char of HostManager.generateInviteCode()) {
					seen.add(char);
				}
			}
			assert.equal(seen.size, lib.HostInvite.codeAlphabet.length);
		});
	});

	describe("HostInviteUpdateRequest", function() {
		it("changes only the given limits", async function() {
			const invite = controller.hosts.createInvite(Date.now() + 60e3, 1, "test");
			await controlConnection.handleHostInviteUpdateRequest(new lib.HostInviteUpdateRequest(invite.id, null));
			assert.equal(controller.hosts.invites.get(invite.id).expiresAtMs, null);
			assert.equal(controller.hosts.invites.get(invite.id).maxUses, 1);
			await controlConnection.handleHostInviteUpdateRequest(
				new lib.HostInviteUpdateRequest(invite.id, undefined, 5)
			);
			assert.equal(controller.hosts.invites.get(invite.id).expiresAtMs, null);
			assert.equal(controller.hosts.invites.get(invite.id).maxUses, 5);
		});
		it("extends a used up invite", async function() {
			const invite = controller.hosts.createInvite(null, 1, "test");
			assert(controller.hosts.claimInvite(invite.code));
			assert.equal(controller.hosts.claimInvite(invite.code), null);
			await controlConnection.handleHostInviteUpdateRequest(
				new lib.HostInviteUpdateRequest(invite.id, undefined, 2)
			);
			assert(controller.hosts.claimInvite(invite.code));
		});
		it("pauses and resumes an invite", async function() {
			const invite = controller.hosts.createInvite(null, null, "test");
			await controlConnection.handleHostInviteUpdateRequest(
				new lib.HostInviteUpdateRequest(invite.id, undefined, undefined, true)
			);
			assert.equal(controller.hosts.invites.get(invite.id).paused, true);
			assert.equal(controller.hosts.claimInvite(invite.code), null);
			await controlConnection.handleHostInviteUpdateRequest(
				new lib.HostInviteUpdateRequest(invite.id, undefined, undefined, false)
			);
			assert(controller.hosts.claimInvite(invite.code));
		});
		it("extends an invite expired less than 24 hours ago", async function() {
			const invite = controller.hosts.createInvite(Date.now() + 60e3, null, "test");
			controller.hosts.invites.getMutable(invite.id).expiresAtMs = Date.now() - 23 * 3600e3;
			await controlConnection.handleHostInviteUpdateRequest(new lib.HostInviteUpdateRequest(invite.id, null));
			assert(controller.hosts.claimInvite(invite.code));
		});
		it("refuses to change an invite expired over 24 hours ago", async function() {
			const invite = controller.hosts.createInvite(Date.now() + 60e3, null, "test");
			controller.hosts.invites.getMutable(invite.id).expiresAtMs = Date.now() - 25 * 3600e3;
			await assert.rejects(
				controlConnection.handleHostInviteUpdateRequest(new lib.HostInviteUpdateRequest(invite.id, null)),
				new lib.InvalidValueError(
					`Host invite ${invite.id} expired over 24 hours ago and cannot be changed`
				),
			);
			assert.equal(controller.hosts.findInvite(invite.code), undefined);
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
			const invite = controller.hosts.createInvite(null, null, "test");
			await controlConnection.handleHostInviteRevokeRequest(new lib.HostInviteRevokeRequest(invite.id));
			assert.equal(controller.hosts.invites.has(invite.id), false);
			assert.equal(controller.hosts.claimInvite(invite.code), null);
			assert.equal(broadcasts.at(-1).updates[0].isDeleted, true);
		});
	});

	describe("HostInviteListRequest", function() {
		it("lists all invites", async function() {
			controller.hosts.createInvite(null, null, "test");
			controller.hosts.createInvite(null, 1, "test");
			const invites = await controlConnection.handleHostInviteListRequest();
			assert.equal(invites.length, 2);
		});
	});

	describe("HostManager.claimInvite()", function() {
		it("issues a token for a new host id and counts the use", function() {
			const invite = controller.hosts.createInvite(null, 2, "test");
			const first = controller.hosts.claimInvite(invite.code);
			const second = controller.hosts.claimInvite(invite.code);
			assert.equal(hostIdOf(first.token), first.hostId);
			assert.equal(hostIdOf(second.token), second.hostId);
			assert.notEqual(first.hostId, second.hostId);
			assert.deepEqual(controller.hosts.invites.get(invite.id).hostIds, [first.hostId, second.hostId]);
			assert.equal(controller.hosts.claimInvite(invite.code), null);
		});
		it("refuses expired invites", function() {
			const invite = controller.hosts.createInvite(Date.now() + 60e3, null, "test");
			controller.hosts.invites.getMutable(invite.id).expiresAtMs = Date.now() - 1;
			assert.equal(controller.hosts.claimInvite(invite.code), null);
		});
		it("refuses all invites while invites are paused globally", function() {
			const invite = controller.hosts.createInvite(null, null, "test");
			controller.config.set("controller.host_invites_paused", true);
			assert.equal(controller.hosts.claimInvite(invite.code), null);
			controller.config.set("controller.host_invites_paused", false);
			assert(controller.hosts.claimInvite(invite.code));
		});
		it("refuses unknown codes", function() {
			controller.hosts.createInvite(null, null, "test");
			assert.equal(controller.hosts.claimInvite("ZZZZZZZZ"), null);
		});
		it("avoids ids of existing hosts and earlier claims", function() {
			const invite = controller.hosts.createInvite(null, null, "test");
			controller.hosts.records.set(new HostRecord(5, "existing", "2.0.0", new Map()));
			const original = crypto.randomInt;
			const ids = [5, 6, 5, 6, 7];
			crypto.randomInt = () => ids.shift();
			try {
				assert.equal(controller.hosts.claimInvite(invite.code).hostId, 6);
				assert.equal(controller.hosts.claimInvite(invite.code).hostId, 7);
			} finally {
				crypto.randomInt = original;
			}
		});
	});

	describe("HostManager.pruneInvites()", function() {
		function createInvites(now) {
			const active = controller.hosts.createInvite(null, null, "test");
			const expired = controller.hosts.createInvite(now + 1000, null, "test");
			const usedUp = controller.hosts.createInvite(null, 1, "test");
			controller.hosts.claimInvite(usedUp.code);
			return { active, expired, usedUp };
		}
		it("removes invites the retention time after they stopped being usable", function() {
			const now = Date.now();
			const { active, expired, usedUp } = createInvites(now);
			controller.hosts.pruneInvites(now + 6 * 86400e3);
			assert.equal(controller.hosts.invites.size, 3);
			controller.hosts.pruneInvites(now + 1000 + 7 * 86400e3);
			assert.equal(controller.hosts.invites.has(expired.id), false);
			assert.equal(controller.hosts.invites.has(usedUp.id), false);
			assert.equal(controller.hosts.invites.has(active.id), true);
		});
		it("uses controller.host_invite_retention_days", function() {
			controller.config.set("controller.host_invite_retention_days", 1);
			const now = Date.now();
			createInvites(now);
			controller.hosts.pruneInvites(now + 1000 + 86400e3);
			assert.equal(controller.hosts.invites.size, 1);
		});
		it("keeps invites forever with a retention of 0", function() {
			controller.config.set("controller.host_invite_retention_days", 0);
			const now = Date.now();
			createInvites(now);
			controller.hosts.pruneInvites(now + 1000 * 86400e3);
			assert.equal(controller.hosts.invites.size, 3);
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
			const invite = controller.hosts.createInvite(null, 3, "test");
			const response = await fetch(`${endpoint}/${invite.code.toLowerCase()}`);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("cache-control"), "no-store");
			assert.deepEqual(await response.json(), { expiresAtMs: null, usesLeft: 3, name: null });
			assert.equal(controller.hosts.invites.get(invite.id).uses, 0);
		});
		it("claims an invite with POST", async function() {
			const invite = controller.hosts.createInvite(null, 1, "test");
			const response = await fetch(`${endpoint}/${invite.code}`, { method: "POST" });
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("cache-control"), "no-store");
			const { hostId, token, name } = await response.json();
			assert.equal(hostIdOf(token), hostId);
			assert.equal(name, null);
			const again = await fetch(`${endpoint}/${invite.code}`, { method: "POST" });
			assert.equal(again.status, 404);
		});
		it("responds the same for unknown, malformed, expired and used up invites", async function() {
			controller.hosts.inviteLimiter.maxFailures = 100;
			const expired = controller.hosts.createInvite(Date.now() + 60e3, null, "test");
			controller.hosts.invites.getMutable(expired.id).expiresAtMs = Date.now() - 1;
			const usedUp = controller.hosts.createInvite(null, 1, "test");
			controller.hosts.claimInvite(usedUp.code);
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
		it("returns the host name from the URL parameter or the body", async function() {
			const invite = controller.hosts.createInvite(null, null, "test");
			let response = await fetch(`${endpoint}/${invite.code}?name=from-url`, { method: "POST" });
			assert.equal((await response.json()).name, "from-url");
			response = await fetch(`${endpoint}/${invite.code}?name=from-url`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "from-body" }),
			});
			assert.equal((await response.json()).name, "from-body");
			response = await fetch(`${endpoint}/${invite.code}?name=from-url`);
			assert.equal((await response.json()).name, "from-url");
			assert.equal(controller.hosts.invites.get(invite.id).uses, 2);
		});
		it("rejects an invalid host name without using the invite", async function() {
			const invite = controller.hosts.createInvite(null, null, "test");
			for (const name of ["", " ", "x".repeat(101)]) {
				const response = await fetch(`${endpoint}/${invite.code}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name }),
				});
				assert.equal(response.status, 400, JSON.stringify(name));
			}
			assert.equal(controller.hosts.invites.get(invite.id).uses, 0);
		});
		it("responds 503 while invites are paused globally without counting failures", async function() {
			const invite = controller.hosts.createInvite(null, null, "test");
			controller.config.set("controller.host_invites_paused", true);
			for (let i = 0; i < 6; i++) {
				const response = await fetch(`${endpoint}/${invite.code}`, { method: "POST" });
				assert.equal(response.status, 503);
			}
			controller.config.set("controller.host_invites_paused", false);
			const response = await fetch(`${endpoint}/${invite.code}`, { method: "POST" });
			assert.equal(response.status, 200);
		});
		it("treats paused and long expired invites like unknown codes", async function() {
			const paused = controller.hosts.createInvite(null, null, "test");
			controller.hosts.updateInvite(paused.id, { paused: true });
			const dead = controller.hosts.createInvite(Date.now() + 60e3, null, "test");
			controller.hosts.invites.getMutable(dead.id).expiresAtMs = Date.now() - 25 * 3600e3;
			const unknown = await (await fetch(`${endpoint}/ZZZZZZZZ`)).text();
			for (const code of [paused.code, dead.code]) {
				const response = await fetch(`${endpoint}/${code}`);
				assert.equal(response.status, 404);
				assert.equal(await response.text(), unknown);
			}
		});
		it("lets only one of many concurrent claims use a single use invite", async function() {
			controller.hosts.inviteLimiter.maxFailures = 100;
			const invite = controller.hosts.createInvite(null, 1, "test");
			const responses = await Promise.all(
				Array.from({ length: 8 }, () => fetch(`${endpoint}/${invite.code}`, { method: "POST" }))
			);
			const statuses = responses.map(r => r.status).sort();
			assert.deepEqual(statuses, [200, 404, 404, 404, 404, 404, 404, 404]);
			assert.equal(controller.hosts.invites.get(invite.id).uses, 1);
		});
		it("blocks an address after 5 invalid attempts, even with a valid code", async function() {
			const invite = controller.hosts.createInvite(null, null, "test");
			for (let i = 0; i < 5; i++) {
				const response = await fetch(`${endpoint}/ZZZZZZZZ`, { method: "POST" });
				assert.equal(response.status, 404);
			}
			const blocked = await fetch(`${endpoint}/${invite.code}`, { method: "POST" });
			assert.equal(blocked.status, 429);
			assert(Number(blocked.headers.get("retry-after")) > 0);
			assert.equal(controller.hosts.invites.get(invite.id).uses, 0);
		});
		it("does not count successful claims as failures", async function() {
			const invite = controller.hosts.createInvite(null, null, "test");
			for (let i = 0; i < 7; i++) {
				const response = await fetch(`${endpoint}/${invite.code}`, { method: "POST" });
				assert.equal(response.status, 200);
			}
		});
	});
});
