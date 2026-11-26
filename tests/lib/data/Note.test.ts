import t from "tap";
import * as lib from "@clusterio/lib";

t.test("Note", async t1 => {
	t1.test("id", async t2 => {
		t2.test("joins resource type and id with a slash", async t3 => {
			t3.equal(new lib.Note("instance", "12", "text").id, "instance/12");
		});
	});

	t1.test("idFor()", async t2 => {
		t2.test("accepts numeric ids", async t3 => {
			t3.equal(lib.Note.idFor("host", 7), "host/7");
		});
	});

	t1.test("toJSON()", async t2 => {
		t2.test("leaves out default values", async t3 => {
			t3.strictSame(new lib.Note("user", "a", "text").toJSON(), {
				resourceType: "user", resourceId: "a", content: "text",
			});
		});
		t2.test("includes values that differ from the defaults", async t3 => {
			t3.strictSame(new lib.Note("user", "a", "text", "admin", 10, true).toJSON(), {
				resourceType: "user", resourceId: "a", content: "text",
				updatedBy: "admin", updatedAtMs: 10, isDeleted: true,
			});
		});
	});

	t1.test("fromJSON()", async t2 => {
		t2.test("fills in defaults for missing fields", async t3 => {
			const note = lib.Note.fromJSON({ resourceType: "role", resourceId: "1", content: "c" });
			t3.equal(note.updatedBy, "");
			t3.equal(note.updatedAtMs, 0);
			t3.equal(note.isDeleted, false);
		});
	});
});
