"use strict";
const assert = require("assert").strict;
const { ControllerUser } = require("@clusterio/controller");

describe("controller/src/ControllerUser", function() {
	describe("class ControllerUser", function() {
		class MockUserManager {
			roles = new Map([
				[1, new lib.Role(1, "a", "a role", new Set(["core.admin"]))],
				[2, new lib.Role(2, "b", "b role", new Set(["test"]))],
			]);
		}
		const userManager = new MockUserManager();

		it("should round trip serialize", function() {
			function test_roundtrip(serialized) {
				let user = ControllerUser.fromJSON(serialized, userManager);
				let user_serialized = user.toJSON();
				assert.deepEqual(user_serialized, serialized);
				let user_deserialized = ControllerUser.fromJSON(user_serialized, userManager);
				assert.deepEqual(user_deserialized, user);
			}

			test_roundtrip({ name: "admin", roles: [1] });
			test_roundtrip({ name: "user", roles: [2], token_valid_after: 12345 });
			test_roundtrip({ name: "user", is_admin: true, is_whitelisted: true });
			test_roundtrip({ name: "user", is_banned: true, ban_reason: "Bad user" });
			test_roundtrip({ name: "user", instance_stats: [[1, { join_count: 1 }]]});
		});
		describe(".checkPermission()", function() {
			it("should correctly resolve permissions", function() {
				let a = ControllerUser.fromJSON({ name: "admin", roles: [1] }, userManager);
				let b = ControllerUser.fromJSON({ name: "user", roles: [2] }, userManager);
				let c = ControllerUser.fromJSON({ name: "null", roles: [] }, userManager);

				a.checkPermission("core.control.connect");
				assert.throws(() => b.checkPermission("core.control.connect"), new Error("Permission denied"));
				assert.throws(() => c.checkPermission("core.control.connect"), new Error("Permission denied"));

				a.checkPermission("test");
				b.checkPermission("test");
				assert.throws(() => c.checkPermission("test"), new Error("Permission denied"));

				assert.throws(() => a.checkPermission("invalid"), new Error("permission invalid does not exist"));
			});
		});
	});
});
