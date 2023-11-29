"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");


describe("lib/users", function() {
	describe("definePermission()", function() {
		it("should validate the types of its arguments", function() {
			assert.throws(
				() => lib.definePermission({ name: 123, title: "Test", description: "A test" }),
				new Error("Expected name to be a non-empty string")
			);
			assert.throws(
				() => lib.definePermission({ name: "test", title: 123, description: "A test" }),
				new Error("Expected title to be a non-empty string")
			);
			assert.throws(
				() => lib.definePermission({ name: "test", title: "Test", description: 123 }),
				new Error("Expected description to be a non-empty string")
			);
			assert.throws(
				() => lib.definePermission({
					name: "test", title: "Test", description: "A test", grantByDefault: 1,
				}),
				new Error("Expected grantByDefault to be a boolean")
			);
		});

		it("should define a permission", function() {
			lib.definePermission({ name: "test", title: "Test", description: "A test" });
			assert(lib.permissions.has("test"), "Permission was not defined");

			let test = lib.permissions.get("test");
			assert.equal(test.name, "test");
			assert.equal(test.title, "Test");
			assert.equal(test.description, "A test");
			assert.equal(test.grantByDefault, false);
		});

		it("should throw on already defined permission", function() {
			assert.throws(
				() => lib.definePermission({ name: "test", title: "Test", description: "A test" }),
				new Error("Permission 'test' is already defined")
			);
		});
	});

	describe("class Role", function() {
		it("should round trip serialize", function() {
			let orig = lib.Role.fromJSON({ id: 11, name: "Role", description: "My Role", permissions: ["test"] });
			let copy = lib.Role.fromJSON(orig.toJSON());
			assert.deepEqual(copy, orig);
		});

		describe(".grantDefaultRoles()", function() {
			it("should only grant permissions with grantByDefault", function() {
				let role = lib.Role.fromJSON({ id: 11, name: "Role", description: "My Role" });
				role.grantDefaultPermissions();
				assert(role.permissions.size > 0, "No permissions were granted");
				for (let permission of role.permissions) {
					assert(
						lib.permissions.get(permission).grantByDefault === true,
						"Non-default permission granted"
					);
				}
			});
		});
	});

	describe("class User", function() {
		it("should round trip serialize", function() {
			function test_roundtrip(serialized) {
				let user = lib.User.fromJSON(serialized);
				let user_serialized = user.toJSON();
				assert.deepEqual(user_serialized, serialized);
				let user_deserialized = lib.User.fromJSON(user_serialized);
				assert.deepEqual(user_deserialized, user);
			}

			test_roundtrip({ name: "admin", roles: [1] });
			test_roundtrip({ name: "user", is_admin: true, is_whitelisted: true });
			test_roundtrip({ name: "user", is_banned: true, ban_reason: "Bad user" });
			test_roundtrip({ name: "user", instance_stats: [[1, { join_count: 1 }]]});
		});
		it("should keep invalid roles", function() {
			let user = lib.User.fromJSON({ name: "test", roles: [1, 4, 55] });
			assert.equal(user.roleIds.size, 3, "Unexpected count of roles");
		});
		it("should calculate playerStats", function() {
			let user = lib.User.fromJSON({ name: "test", roles: [1], instance_stats: [
				[1, {
					join_count: 1,
					online_time_ms: 60e3,
					last_join_at: new Date("2020-05T12:00Z").getTime(),
					last_leave_at: new Date("2020-05T12:01Z").getTime(),
					last_leave_reason: "quit",
				}],
				[2, {
					join_count: 1,
					online_time_ms: 0,
					last_join_at: new Date("2020-05T12:02Z").getTime(),
				}],
				[3, {
					join_count: 2,
					online_time_ms: 120e3,
					last_join_at: new Date("2020-05T11:00Z").getTime(),
					last_leave_at: new Date("2020-05T11:02Z").getTime(),
					last_leave_reason: "afk",
				}],
			]});

			assert.equal(user.playerStats.onlineTimeMs, 180e3);
			assert.equal(user.playerStats.joinCount, 4);
			assert.deepEqual(user.playerStats.lastJoinAt, new Date("2020-05T12:02Z"));
			assert.deepEqual(user.playerStats.lastLeaveAt, new Date("2020-05T12:01Z"));
			assert.equal(user.playerStats.lastLeaveReason, "quit");
		});
	});
});
