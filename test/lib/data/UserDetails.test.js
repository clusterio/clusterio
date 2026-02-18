"use strict";
const assert = require("assert").strict;
const { UserDetails, PlayerStats } = require("@clusterio/lib");

const { testMatrix, testRoundTripJsonSerialisable } = require("../../common");

describe("lib/data/UserDetails", function () {
	it("should be round trip serialisable", function () {
		testRoundTripJsonSerialisable(UserDetails, testMatrix(
			["TestUser"], // name (required)
			[undefined, new Set([1])], // roleIds
			[undefined, new Set([2])], // instances
			[undefined, true], // isAdmin
			[undefined, true], // isBanned
			[undefined, true], // isWhitelisted
			[undefined, "reason"], // banReason
			[undefined, 123], // updatedAtMs
			[undefined, true], // isDeleted
			[ // instanceStats
				undefined,
				new Map([
					[1, PlayerStats.fromJSON({ join_count: 1, online_time_ms: 100 })],
				]),
			],
		));
	});

	describe("constructor", function () {
		it("should set defaults correctly", function () {
			const user = new UserDetails("TestUser");

			assert.equal(user.name, "TestUser");
			assert.equal(user.roleIds.size, 0);
			assert.equal(user.instances.size, 0);
			assert.equal(user.isAdmin, false);
			assert.equal(user.isBanned, false);
			assert.equal(user.isWhitelisted, false);
			assert.equal(user.banReason, "");
			assert.equal(user.updatedAtMs, 0);
			assert.equal(user.isDeleted, false);
			assert(user.playerStats instanceof PlayerStats);
			assert(user.instanceStats instanceof Map);
		});

		it("should accept all constructor parameters", function () {
			const user = new UserDetails(
				"TestUser", new Set([1]), new Set([2]),
				true, true, true, "reason",
				100, true,
				new Map()
			);

			assert.equal(user.name, "TestUser");
			assert.deepEqual(user.roleIds, new Set([1]));
			assert.deepEqual(user.instances, new Set([2]));
			assert.equal(user.isAdmin, true);
			assert.equal(user.isBanned, true);
			assert.equal(user.isWhitelisted, true);
			assert.equal(user.banReason, "reason");
			assert.equal(user.updatedAtMs, 100);
			assert.equal(user.isDeleted, true);
		});
	});

	describe("get id", function () {
		it("should return lowercase name", function () {
			const user = new UserDetails("AdMiN");
			assert.equal(user.id, "admin");
		});

		it("should reflect name changes dynamically", function () {
			const user = new UserDetails("User");
			user.name = "NEWNAME";
			assert.equal(user.id, "newname");
		});
	});

	describe(".toJSON()", function () {
		it("should only include required fields when optional fields are not given", function () {
			const user = new UserDetails("Test");
			assert.deepEqual(user.toJSON(), { name: "Test" });
		});

		it("should include all optional fields when set", function () {
			const stats = new PlayerStats({ join_count: 1 });
			const user = new UserDetails(
				"Test", new Set([1, 2]), new Set([10]),
				true, true, true, "reason",
				123, true,
				new Map([[1, stats]])
			);

			assert.deepEqual(user.toJSON(), {
				name: "Test",
				roles: [1, 2],
				instances: [10],
				is_admin: true,
				is_banned: true,
				is_whitelisted: true,
				ban_reason: "reason",
				updated_at_ms: 123,
				is_deleted: true,
				instance_stats: [[1, stats.toJSON()]],
			});
		});

		it("should omit optional fields when equal to defaults", function () {
			const user = new UserDetails(
				"Test", new Set(), new Set(),
				false, false, false, "",
				0, false,
				new Map()
			);

			assert.deepEqual(user.toJSON(), { name: "Test" });
		});
	});

	describe("static fromJSON()", function () {
		it("should construct minimal object", function () {
			const user = UserDetails.fromJSON({ name: "Test" });

			assert.equal(user.name, "Test");
			assert.deepEqual(user.roleIds, new Set());
			assert.deepEqual(user.instances, new Set());
			assert.deepEqual(user.isAdmin, false);
			assert.equal(user.isBanned, false);
			assert.equal(user.isWhitelisted, false);
			assert.equal(user.banReason, "");
			assert.equal(user.updatedAtMs, 0);
			assert.equal(user.isDeleted, false);
			assert.deepEqual(user.instanceStats, new Map());
		});

		it("should preserve optional fields exactly when provided", function () {
			const stats = new PlayerStats({ join_count: 1 });
			const user = UserDetails.fromJSON({
				name: "Test",
				roles: [1, 2],
				instances: [10],
				is_admin: true,
				is_banned: true,
				is_whitelisted: true,
				ban_reason: "reason",
				updated_at_ms: 123,
				is_deleted: true,
				instance_stats: [[1, stats.toJSON()]],
			});

			assert.equal(user.name, "Test");
			assert.deepEqual(user.roleIds, new Set([1, 2]));
			assert.deepEqual(user.instances, new Set([10]));
			assert.deepEqual(user.isAdmin, true);
			assert.equal(user.isBanned, true);
			assert.equal(user.isWhitelisted, true);
			assert.equal(user.banReason, "reason");
			assert.equal(user.updatedAtMs, 123);
			assert.equal(user.isDeleted, true);
			assert.deepEqual(user.instanceStats, new Map([[1, stats]]));
		});

		it("should preserve roles exactly (including invalid ones)", function () {
			const user = UserDetails.fromJSON({
				name: "Test",
				roles: [1, 4, 55],
			});

			assert.equal(user.roleIds.size, 3);
			assert(user.roleIds.has(55));
		});

		it("should reconstruct instanceStats and calculate playerStats", function () {
			const json = {
				name: "Test",
				instance_stats: [
					[1, { join_count: 1, online_time_ms: 100 }],
					[2, { join_count: 2, online_time_ms: 200 }],
				],
			};

			const user = UserDetails.fromJSON(json);

			assert.equal(user.instanceStats.size, 2);
			assert.equal(user.playerStats.joinCount, 3);
			assert.equal(user.playerStats.onlineTimeMs, 300);
		});
	});

	describe(".recalculatePlayerStats()", function () {
		it("should aggregate stats correctly across multiple instances", function () {
			const user = UserDetails.fromJSON({
				name: "test",
				instance_stats: [
					[1, {
						join_count: 1,
						online_time_ms: 60e3,
						last_join_at_ms: new Date("2020-05-05T12:00Z").getTime(),
						last_leave_at_ms: new Date("2020-05-05T12:01Z").getTime(),
						last_leave_reason: "quit",
					}],
					[2, {
						join_count: 1,
						online_time_ms: 0,
						first_join_at_ms: new Date("2020-05-05T12:00Z").getTime(),
						last_join_at_ms: new Date("2020-05-05T12:02Z").getTime(),
					}],
				],
			});

			assert.equal(user.playerStats.joinCount, 2);
			assert.equal(user.playerStats.onlineTimeMs, 60e3);

			user.instanceStats.set(3, PlayerStats.fromJSON({
				join_count: 2,
				online_time_ms: 120e3,
				first_join_at_ms: new Date("2020-05-05T11:00Z").getTime(),
				last_join_at_ms: new Date("2020-05-05T13:00Z").getTime(),
				last_leave_at_ms: new Date("2020-05-05T13:02Z").getTime(),
				last_leave_reason: "afk",
			}));

			user.recalculatePlayerStats();

			assert.equal(user.playerStats.joinCount, 4);
			assert.equal(user.playerStats.onlineTimeMs, 180e3);
		});
	});

	describe("static _calculatePlayerStats()", function () {
		it("should return empty stats for empty map", function () {
			const stats = UserDetails._calculatePlayerStats(new Map());
			assert.equal(stats.joinCount, 0);
			assert.equal(stats.onlineTimeMs, 0);
		});

		it("should pick earliest firstJoin and latest joins/leaves", function () {
			const a = PlayerStats.fromJSON({
				first_join_at_ms: new Date("2020-01-01").getTime(),
				last_join_at_ms: new Date("2020-01-02").getTime(),
				last_leave_at_ms: new Date("2020-01-02").getTime(),
				last_leave_reason: "quit",
				join_count: 1,
				online_time_ms: 100,
			});

			const b = PlayerStats.fromJSON({
				first_join_at_ms: new Date("2019-01-01").getTime(),
				last_join_at_ms: new Date("2021-01-01").getTime(),
				last_leave_at_ms: new Date("2021-01-02").getTime(),
				last_leave_reason: "afk",
				join_count: 2,
				online_time_ms: 200,
			});

			const stats = UserDetails._calculatePlayerStats(
				new Map([[1, a], [2, b]])
			);

			assert.equal(stats.joinCount, 3);
			assert.equal(stats.onlineTimeMs, 300);
			assert.deepEqual(stats.firstJoinAt, new Date("2019-01-01"));
			assert.deepEqual(stats.lastJoinAt, new Date("2021-01-01"));
			assert.deepEqual(stats.lastLeaveAt, new Date("2021-01-02"));
			assert.equal(stats.lastLeaveReason, "afk");
		});
	});
});
