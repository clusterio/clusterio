"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");
const { User } = require("@clusterio/controller");

describe("controller/src/User", function() {
	describe("class User", function() {
		const roles = new Map([
			[1, new lib.Role(1, "a", "a role", new Set(["core.admin"]))],
			[2, new lib.Role(2, "b", "b role", new Set(["user-test"]))],
		]);

		it("should round trip serialize", function() {
			function testRoundTrip(serialized) {
				let user = User.fromJSON(serialized, {}, roles);
				let user_serialized = user.toJSON();
				assert.deepEqual(user_serialized, serialized);
				let user_deserialized = User.fromJSON(user_serialized, {}, roles);
				assert.deepEqual(user_deserialized, user);
			}

			testRoundTrip({ name: "admin", roles: [1] });
			testRoundTrip({ name: "user", roles: [2], token_valid_after: 12345 });
			testRoundTrip({ name: "user", is_admin: true, is_whitelisted: true });
			testRoundTrip({ name: "user", is_banned: true, ban_reason: "Bad user" });
			testRoundTrip({ name: "user", instance_stats: [[1, { join_count: 1 }]]});
		});
		describe(".checkPermission()", function() {
			it("should correctly resolve permissions", function() {
				lib.definePermission({ name: "user-test", title: "Test", description: "User Test" });
				let a = User.fromJSON({ name: "admin", roles: [1] }, {}, roles);
				let b = User.fromJSON({ name: "user", roles: [2] }, {}, roles);
				let c = User.fromJSON({ name: "null", roles: [] }, {}, roles);

				a.checkPermission("core.control.connect");
				assert.throws(() => b.checkPermission("core.control.connect"), new Error("Permission denied"));
				assert.throws(() => c.checkPermission("core.control.connect"), new Error("Permission denied"));

				a.checkPermission("user-test");
				b.checkPermission("user-test");
				assert.throws(() => c.checkPermission("user-test"), new Error("Permission denied"));

				assert.throws(() => a.checkPermission("invalid"), new Error("permission invalid does not exist"));
			});
		});
	});
});
