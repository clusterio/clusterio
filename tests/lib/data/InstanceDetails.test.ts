import t from "tap";
import * as lib from "@clusterio/lib";

t.test("InstanceDetails", async t1 => {
	t1.test("isDeleted", async t2 => {
		t2.test("is true only for the deleted status", async t3 => {
			for (const status of ["running", "stopped", "unassigned"] as const) {
				t3.equal(new lib.InstanceDetails("a", 1, 2, 3, status, "2.0").isDeleted, false, status);
			}
			t3.equal(new lib.InstanceDetails("a", 1, 2, 3, "deleted", "2.0").isDeleted, true);
		});
	});

	t1.test("toJSON()", async t2 => {
		t2.test("leaves out default and undefined values", async t3 => {
			const instance = new lib.InstanceDetails("a", 1, undefined, undefined, "unassigned", undefined);
			t3.strictSame(instance.toJSON(), { name: "a", id: 1, status: "unassigned" });
		});
		t2.test("includes values that differ from the defaults", async t3 => {
			const instance = new lib.InstanceDetails("a", 1, 2, 3, "running", "2.0.1", 10, 20, true, true, 4, 5);
			t3.strictSame(instance.toJSON(), {
				name: "a", id: 1, status: "running", assignedHost: 2, gamePort: 3, factorioVersion: "2.0.1",
				startedAtMs: 10, updatedAtMs: 20, excludeFromStartAll: true, isTemplate: true,
				templateId: 4, modPackId: 5,
			});
		});
	});

	t1.test("fromJSON()", async t2 => {
		t2.test("fills in defaults for missing fields", async t3 => {
			const instance = lib.InstanceDetails.fromJSON({ name: "a", id: 1, status: "stopped" });
			t3.equal(instance.startedAtMs, 0);
			t3.equal(instance.updatedAtMs, 0);
			t3.equal(instance.excludeFromStartAll, false);
			t3.equal(instance.isTemplate, false);
			t3.equal(instance.templateId, undefined);
			t3.equal(instance.modPackId, undefined);
		});
	});
});
