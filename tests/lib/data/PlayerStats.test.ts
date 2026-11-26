import t from "tap";
import * as lib from "@clusterio/lib";

function stats(json: ConstructorParameters<typeof lib.PlayerStats>[0]) {
	return new lib.PlayerStats(json);
}

t.test("PlayerStats", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("defaults to zero counts and no timestamps", async t3 => {
			const empty = new lib.PlayerStats();
			t3.equal(empty.joinCount, 0);
			t3.equal(empty.onlineTimeMs, 0);
			t3.equal(empty.firstJoinAt, undefined);
			t3.equal(empty.lastJoinAt, undefined);
			t3.equal(empty.lastLeaveAt, undefined);
			t3.equal(empty.lastLeaveReason, undefined);
		});
		t2.test("reads every field", async t3 => {
			const read = stats({
				join_count: 2, online_time_ms: 300, first_join_at_ms: 10,
				last_join_at_ms: 20, last_leave_at_ms: 30, last_leave_reason: "kicked",
			});
			t3.equal(read.joinCount, 2);
			t3.equal(read.onlineTimeMs, 300);
			t3.strictSame(read.firstJoinAt, new Date(10));
			t3.strictSame(read.lastJoinAt, new Date(20));
			t3.strictSame(read.lastLeaveAt, new Date(30));
			t3.equal(read.lastLeaveReason, "kicked");
		});
		t2.test("migrates the alpha 13 field names", async t3 => {
			const read = stats({ last_join_at: 20, last_leave_at: 30 });
			t3.strictSame(read.lastJoinAt, new Date(20));
			t3.strictSame(read.lastLeaveAt, new Date(30));
		});
		t2.test("prefers the new field names over the alpha 13 ones", async t3 => {
			const read = stats({ last_join_at_ms: 20, last_join_at: 1, last_leave_at_ms: 30, last_leave_at: 2 });
			t3.strictSame(read.lastJoinAt, new Date(20));
			t3.strictSame(read.lastLeaveAt, new Date(30));
		});
		t2.test("uses the last join as first join when it is missing", async t3 => {
			t3.strictSame(stats({ last_join_at_ms: 20 }).firstJoinAt, new Date(20));
		});
		t2.test("defaults the leave reason to quit", async t3 => {
			t3.equal(stats({ last_leave_at_ms: 30 }).lastLeaveReason, "quit");
		});
		t2.test("ignores a leave reason without a leave time", async t3 => {
			t3.equal(stats({ last_leave_reason: "kicked" }).lastLeaveReason, undefined);
		});
	});

	t1.test("fromJSON()", async t2 => {
		t2.test("creates an instance from the JSON", async t3 => {
			const read = lib.PlayerStats.fromJSON({ join_count: 3 });
			t3.ok(read instanceof lib.PlayerStats);
			t3.equal(read.joinCount, 3);
		});
	});

	t1.test("toJSON()", async t2 => {
		t2.test("leaves out unset fields", async t3 => {
			t3.strictSame(new lib.PlayerStats().toJSON(), {});
		});
		t2.test("writes every set field", async t3 => {
			const json = {
				join_count: 2, online_time_ms: 300, first_join_at_ms: 10,
				last_join_at_ms: 20, last_leave_at_ms: 30, last_leave_reason: "kicked",
			};
			t3.strictSame(stats(json).toJSON(), json);
		});
		t2.test("writes the alpha 13 field names under the new names", async t3 => {
			t3.strictSame(stats({ last_join_at: 20, last_leave_at: 30 }).toJSON(), {
				first_join_at_ms: 20, last_join_at_ms: 20, last_leave_at_ms: 30, last_leave_reason: "quit",
			});
		});
	});

	t1.test("merge()", async t2 => {
		t2.test("adds counts and takes the outer timestamps", async t3 => {
			const merged = stats({
				join_count: 1, online_time_ms: 100, first_join_at_ms: 20,
				last_join_at_ms: 30, last_leave_at_ms: 40, last_leave_reason: "a",
			});
			merged.merge(stats({
				join_count: 2, online_time_ms: 200, first_join_at_ms: 10,
				last_join_at_ms: 50, last_leave_at_ms: 60, last_leave_reason: "b",
			}));
			t3.strictSame(merged.toJSON(), {
				join_count: 3, online_time_ms: 300, first_join_at_ms: 10,
				last_join_at_ms: 50, last_leave_at_ms: 60, last_leave_reason: "b",
			});
		});
		t2.test("keeps the outer timestamps it already has", async t3 => {
			const json = {
				join_count: 1, first_join_at_ms: 10, last_join_at_ms: 50, last_leave_at_ms: 60, last_leave_reason: "a",
			};
			const merged = stats(json);
			merged.merge(stats({ first_join_at_ms: 20, last_join_at_ms: 30, last_leave_at_ms: 40 }));
			t3.strictSame(merged.toJSON(), json);
		});
		t2.test("keeps its timestamps when the other has none", async t3 => {
			const json = { first_join_at_ms: 10, last_join_at_ms: 50, last_leave_at_ms: 60, last_leave_reason: "a" };
			const merged = stats(json);
			merged.merge(new lib.PlayerStats());
			t3.strictSame(merged.toJSON(), json);
		});
		t2.test("takes the other's timestamps when it has none", async t3 => {
			const json = { first_join_at_ms: 10, last_join_at_ms: 50, last_leave_at_ms: 60, last_leave_reason: "a" };
			const merged = new lib.PlayerStats();
			merged.merge(stats(json));
			t3.strictSame(merged.toJSON(), json);
		});
	});
});
