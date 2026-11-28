import t from "tap";
import * as lib from "@clusterio/lib";

function stats(json: ConstructorParameters<typeof lib.PlayerStats>[0]) {
	return new lib.PlayerStats(json);
}

t.test("UserDetails", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("defaults to an empty user", async t3 => {
			const user = new lib.UserDetails("Player");
			t3.strictSame(user.roleIds, new Set());
			t3.strictSame(user.instances, new Set());
			t3.equal(user.isAdmin, false);
			t3.equal(user.isBanned, false);
			t3.equal(user.isWhitelisted, false);
			t3.equal(user.banReason, "");
			t3.equal(user.updatedAtMs, 0);
			t3.equal(user.isDeleted, false);
			t3.strictSame(user.playerStats.toJSON(), {});
		});
		t2.test("calculates the player stats from the instance stats", async t3 => {
			const user = new lib.UserDetails(
				"Player", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
				new Map([[1, stats({ join_count: 1 })], [2, stats({ join_count: 2 })]]),
			);
			t3.equal(user.playerStats.joinCount, 3);
		});
	});

	t1.test("id", async t2 => {
		t2.test("is the lower case name", async t3 => {
			t3.equal(new lib.UserDetails("PlAyEr").id, "player");
		});
	});

	t1.test("toJSON()", async t2 => {
		t2.test("leaves out default values", async t3 => {
			t3.strictSame(new lib.UserDetails("Player").toJSON(), { name: "Player" });
		});
		t2.test("includes values that differ from the defaults", async t3 => {
			const user = new lib.UserDetails(
				"Player", new Set([1, 2]), new Set([3]), true, true, true, "griefing", 10, true,
				new Map([[3, stats({ join_count: 1 })]]),
			);
			t3.strictSame(user.toJSON(), {
				name: "Player",
				roles: [1, 2],
				instances: [3],
				is_admin: true,
				is_whitelisted: true,
				is_banned: true,
				ban_reason: "griefing",
				updated_at_ms: 10,
				is_deleted: true,
				instance_stats: [[3, { join_count: 1 }]],
			});
		});
	});

	t1.test("fromJSON()", async t2 => {
		t2.test("reads every field", async t3 => {
			const user = lib.UserDetails.fromJSON({
				name: "Player", roles: [1], instances: [2], is_admin: true, is_banned: true,
				is_whitelisted: true, ban_reason: "r", updated_at_ms: 5, is_deleted: true,
				instance_stats: [[2, { join_count: 4 }]],
			});
			t3.strictSame(user.roleIds, new Set([1]));
			t3.strictSame(user.instances, new Set([2]));
			t3.equal(user.isAdmin, true);
			t3.equal(user.isBanned, true);
			t3.equal(user.isWhitelisted, true);
			t3.equal(user.banReason, "r");
			t3.equal(user.updatedAtMs, 5);
			t3.equal(user.isDeleted, true);
			t3.ok(user.instanceStats.get(2) instanceof lib.PlayerStats);
			t3.equal(user.playerStats.joinCount, 4);
		});
	});

	t1.test("recalculatePlayerStats()", async t2 => {
		t2.test("picks up changes to the instance stats", async t3 => {
			const user = new lib.UserDetails("Player");
			user.instanceStats.set(1, stats({ join_count: 2, online_time_ms: 100 }));
			t3.equal(user.playerStats.joinCount, 0);
			user.recalculatePlayerStats();
			t3.equal(user.playerStats.joinCount, 2);
			t3.equal(user.playerStats.onlineTimeMs, 100);
		});
	});

	t1.test("_calculatePlayerStats()", async t2 => {
		t2.test("sums counts and takes the earliest join and latest join and leave", async t3 => {
			const combined = lib.UserDetails._calculatePlayerStats(new Map([
				[1, stats({
					join_count: 1, online_time_ms: 100, first_join_at_ms: 20,
					last_join_at_ms: 50, last_leave_at_ms: 40, last_leave_reason: "a",
				})],
				[2, stats({
					join_count: 2, online_time_ms: 200, first_join_at_ms: 10,
					last_join_at_ms: 30, last_leave_at_ms: 60, last_leave_reason: "b",
				})],
				[3, stats({
					first_join_at_ms: 15, last_join_at_ms: 35, last_leave_at_ms: 45, last_leave_reason: "c",
				})],
			]));
			t3.strictSame(combined.toJSON(), {
				join_count: 3, online_time_ms: 300, first_join_at_ms: 10,
				last_join_at_ms: 50, last_leave_at_ms: 60, last_leave_reason: "b",
			});
		});
		t2.test("skips instances without timestamps", async t3 => {
			const combined = lib.UserDetails._calculatePlayerStats(new Map([
				[1, stats({ first_join_at_ms: 10, last_join_at_ms: 20, last_leave_at_ms: 30 })],
				[2, stats({ join_count: 1 })],
			]));
			t3.strictSame(combined.toJSON(), {
				join_count: 1, first_join_at_ms: 10, last_join_at_ms: 20,
				last_leave_at_ms: 30, last_leave_reason: "quit",
			});
		});
	});
});
