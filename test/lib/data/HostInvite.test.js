import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";

import { testRoundTripJsonSerialisable } from "../../common.js";

describe("lib/data/HostInvite", function() {
	describe("class HostInvite", function() {
		it("should round trip serialize", function() {
			testRoundTripJsonSerialisable(lib.HostInvite, [
				[1, "ABCD2345"],
				[2, "ABCD2345", "admin", 1000, 2000, 3, [11, 12], 1500, false, 1600],
				[3, "ABCD2345", "", 0, null, null, [], 0, false, 1234, true],
				[4, "ABCD2345", "", 0, null, null, [], 0, true],
			]);
		});
		it("should omit default optional fields from json", function() {
			const invite = new lib.HostInvite(1, "ABCD2345");
			assert.deepEqual(invite.toJSON(), { id: 1, code: "ABCD2345" });
		});
		it("should not use confusable characters in the code alphabet", function() {
			for (const char of "01OIL") {
				assert(!lib.HostInvite.codeAlphabet.includes(char), `alphabet contains ${char}`);
			}
			assert.equal(new Set(lib.HostInvite.codeAlphabet).size, 31);
		});
		it("should be usable until expired, used up or deleted", function() {
			const invite = new lib.HostInvite(1, "ABCD2345", "", 0, 2000, 2);
			assert.equal(invite.isUsable(1000), true);
			assert.equal(invite.isUsable(2000), false);
			invite.hostIds.push(5);
			assert.equal(invite.isUsable(1000), true);
			invite.hostIds.push(6);
			assert.equal(invite.isUsedUp(), true);
			assert.equal(invite.isUsable(1000), false);
			const unlimited = new lib.HostInvite(2, "ABCD2345");
			assert.equal(unlimited.isUsable(Number.MAX_SAFE_INTEGER), true);
			unlimited.paused = true;
			assert.equal(unlimited.isUsable(), false);
			unlimited.paused = false;
			unlimited.isDeleted = true;
			assert.equal(unlimited.isUsable(), false);
		});
		it("should report when it stopped being usable", function() {
			const invite = new lib.HostInvite(1, "ABCD2345", "", 0, 2000, 1);
			assert.equal(invite.inactiveSinceMs(1000), null);
			assert.equal(invite.inactiveSinceMs(3000), 2000);
			invite.hostIds.push(5);
			invite.lastUsedAtMs = 1500;
			assert.equal(invite.inactiveSinceMs(1600), 1500);
			assert.equal(invite.inactiveSinceMs(3000), 1500);
		});
	});

	describe("HostInvite.isDead()", function() {
		it("should be true 24 hours after expiry", function() {
			const invite = new lib.HostInvite(1, "ABCD2345", "", 0, 1000);
			assert.equal(invite.isDead(1000 + 86400e3 - 1), false);
			assert.equal(invite.isDead(1000 + 86400e3), true);
			assert.equal(new lib.HostInvite(2, "ABCD2345").isDead(Number.MAX_SAFE_INTEGER), false);
		});
	});

	describe("HostInvite.normalizeCode()", function() {
		it("should accept codes in any case and trim whitespace", function() {
			assert.equal(lib.HostInvite.normalizeCode("abcd2345"), "ABCD2345");
			assert.equal(lib.HostInvite.normalizeCode(" ABCD2345\n"), "ABCD2345");
		});
		it("should reject codes of the wrong length or with other characters", function() {
			const codes = ["", "ABCD234", "ABCD23456", "ABCD2340", "ABCD234O", "ABCD234I", "ABCD-234", "ABCDÉ234"];
			for (const code of codes) {
				assert.equal(lib.HostInvite.normalizeCode(code), null, code);
			}
		});
	});

	describe("HostInvite.parseUrl()", function() {
		it("should split an invite URL into controller URL and code", function() {
			assert.deepEqual(
				lib.HostInvite.parseUrl("https://example.com/invite/abcd2345"),
				{ controllerUrl: "https://example.com/", code: "ABCD2345", name: undefined },
			);
			assert.deepEqual(
				lib.HostInvite.parseUrl("http://example.com:8080/clusterio/invite/ABCD2345/"),
				{ controllerUrl: "http://example.com:8080/clusterio/", code: "ABCD2345", name: undefined },
			);
		});
		it("should drop credentials, query and hash", function() {
			assert.deepEqual(
				lib.HostInvite.parseUrl("https://user:pass@example.com/invite/ABCD2345?a=b#c"),
				{ controllerUrl: "https://example.com/", code: "ABCD2345", name: undefined },
			);
		});
		it("should return the name parameter", function() {
			assert.deepEqual(
				lib.HostInvite.parseUrl("https://example.com/invite/ABCD2345?name=Host%20A"),
				{ controllerUrl: "https://example.com/", code: "ABCD2345", name: "Host A" },
			);
		});
		it("should reject other URLs", function() {
			for (const url of [
				"", "ABCD2345", "https://example.com/", "https://example.com/invite/",
				"https://example.com/invite/ABCD0000", "ftp://example.com/invite/ABCD2345",
				"https://example.com/invite/ABCD2345/extra",
			]) {
				assert.equal(lib.HostInvite.parseUrl(url), null, url);
			}
		});
	});

	describe("HostInvite.redactCode()", function() {
		it("should keep two characters and a fixed length", function() {
			assert.equal(lib.HostInvite.redactCode("ABCD2345"), "AB******");
			assert.equal(lib.HostInvite.redactCode("A".repeat(1000)), "AA******");
		});
	});
});
