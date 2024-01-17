"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");


describe("lib/data/User", function() {
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
					first_join_at: new Date("2020-05T12:00Z").getTime(),
					last_join_at: new Date("2020-05T12:02Z").getTime(),
				}],
			]});

			assert.equal(user.playerStats.onlineTimeMs, 60e3);
			assert.equal(user.playerStats.joinCount, 2);
			assert.deepEqual(user.playerStats.firstJoinAt, new Date("2020-05T12:00Z"));
			assert.deepEqual(user.playerStats.lastJoinAt, new Date("2020-05T12:02Z"));
			assert.deepEqual(user.playerStats.lastLeaveAt, new Date("2020-05T12:01Z"));
			assert.equal(user.playerStats.lastLeaveReason, "quit");

			user.instanceStats.set(
				3,
				lib.PlayerStats.fromJSON({
					join_count: 2,
					online_time_ms: 120e3,
					first_join_at: new Date("2020-05T11:00Z").getTime(),
					last_join_at: new Date("2020-05T13:00Z").getTime(),
					last_leave_at: new Date("2020-05T13:02Z").getTime(),
					last_leave_reason: "afk",
				}),
			);

			user.recalculatePlayerStats();
			assert.equal(user.playerStats.onlineTimeMs, 180e3);
			assert.equal(user.playerStats.joinCount, 4);
			assert.deepEqual(user.playerStats.firstJoinAt, new Date("2020-05T11:00Z"));
			assert.deepEqual(user.playerStats.lastJoinAt, new Date("2020-05T13:00Z"));
			assert.deepEqual(user.playerStats.lastLeaveAt, new Date("2020-05T13:02Z"));
			assert.equal(user.playerStats.lastLeaveReason, "afk");
		});
	});
});
