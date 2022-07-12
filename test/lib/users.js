"use strict";
const assert = require("assert").strict;
const libUsers = require("@clusterio/lib/users");


describe("lib/users", function() {
	describe("definePermission()", function() {
		it("should validate the types of its arguments", function() {
			assert.throws(
				() => libUsers.definePermission({ name: 123, title: "Test", description: "A test" }),
				new Error("Expected name to be a non-empty string")
			);
			assert.throws(
				() => libUsers.definePermission({ name: "test", title: 123, description: "A test" }),
				new Error("Expected title to be a non-empty string")
			);
			assert.throws(
				() => libUsers.definePermission({ name: "test", title: "Test", description: 123 }),
				new Error("Expected description to be a non-empty string")
			);
			assert.throws(
				() => libUsers.definePermission({
					name: "test", title: "Test", description: "A test", grantByDefault: 1,
				}),
				new Error("Expected grantByDefault to be a boolean")
			);
		});

		it("should define a permission", function() {
			libUsers.definePermission({ name: "test", title: "Test", description: "A test" });
			assert(libUsers.permissions.has("test"), "Permission was not defined");

			let test = libUsers.permissions.get("test");
			assert.equal(test.name, "test");
			assert.equal(test.title, "Test");
			assert.equal(test.description, "A test");
			assert.equal(test.grantByDefault, false);
		});

		it("should throw on already defined permission", function() {
			assert.throws(
				() => libUsers.definePermission({ name: "test", title: "Test", description: "A test" }),
				new Error("Permission 'test' is already defined")
			);
		});
	});

	describe("class Role", function() {
		it("should round trip serialize", function() {
			let orig = new libUsers.Role({ id: 11, name: "Role", description: "My Role", permissions: ["test"] });
			let copy = new libUsers.Role(orig.serialize());
			assert.deepEqual(copy, orig);
		});

		describe(".grantDefaultRoles()", function() {
			it("should only grant permissions with grantByDefault", function() {
				let role = new libUsers.Role({ id: 11, name: "Role", description: "My Role" });
				role.grantDefaultPermissions();
				assert(role.permissions.size > 0, "No permissions were granted");
				for (let permission of role.permissions) {
					assert(
						libUsers.permissions.get(permission).grantByDefault === true,
						"Non-default permission granted"
					);
				}
			});
		});
	});

	describe("class User", function() {
		let roles = new Map([
			[1, new libUsers.Role({ id: 1, name: "a", description: "a role", permissions: ["core.admin"] })],
			[2, new libUsers.Role({ id: 2, name: "b", description: "b role", permissions: ["test"] })],
		]);
		it("should round trip serialize", function() {
			function test_roundtrip(serialized) {
				let user = new libUsers.User(serialized, roles);
				let user_serialized = user.serialize();
				assert.deepEqual(user_serialized, serialized);
				let user_deserialized = new libUsers.User(user_serialized, roles);
				assert.deepEqual(user_deserialized, user);
			}

			test_roundtrip({ name: "admin", roles: [1] });
			test_roundtrip({ name: "user", roles: [2], token_valid_after: 12345 });
			test_roundtrip({ name: "user", is_admin: true, is_whitelisted: true });
			test_roundtrip({ name: "user", is_banned: true, ban_reason: "Bad user" });
			test_roundtrip({ name: "user", instance_stats: [[1, { join_count: 1 }]]});
		});
		it("should ignore invalid roles", function() {
			let user = new libUsers.User({ name: "test", roles: [1, 4, 55] }, roles);
			assert.equal(user.roles.size, 1, "Unexpected count of roles");
		});
		it("should track online users", function() {
			let user = new libUsers.User({ name: "admin", roles: [1] }, roles);
			assert(!libUsers.User.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set());

			user.notifyJoin(12);
			assert(libUsers.User.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set([12]));

			user.notifyJoin(8);
			assert(libUsers.User.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set([12, 8]));

			user.notifyLeave(11);
			assert(libUsers.User.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set([12, 8]));

			user.notifyLeave(12);
			assert(libUsers.User.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set([8]));

			user.notifyLeave(8);
			assert(!libUsers.User.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set());
		});
		it("should calculate playerStats", function() {
			let user = new libUsers.User({ name: "test", roles: [1], instance_stats: [
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
			]}, roles);

			assert.equal(user.playerStats.onlineTimeMs, 180e3);
			assert.equal(user.playerStats.joinCount, 4);
			assert.deepEqual(user.playerStats.lastJoinAt, new Date("2020-05T12:02Z"));
			assert.deepEqual(user.playerStats.lastLeaveAt, new Date("2020-05T12:01Z"));
			assert.equal(user.playerStats.lastLeaveReason, "quit");
		});

		describe(".checkPermission()", function() {
			it("should correctly resolve permissions", function() {
				let a = new libUsers.User({ name: "admin", roles: [1] }, roles);
				let b = new libUsers.User({ name: "user", roles: [2] }, roles);
				let c = new libUsers.User({ name: "null", roles: [] }, roles);

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
