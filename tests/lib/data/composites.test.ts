import t from "tap";
import * as lib from "@clusterio/lib";

t.test("composites", async t1 => {
	t1.test("StringEnum()", async t2 => {
		t2.test("makes a string schema limited to the values", async t3 => {
			t3.match(lib.StringEnum(["a", "b"]), { type: "string", enum: ["a", "b"] });
		});
	});

	t1.test("StringKey()", async t2 => {
		t2.test("makes a string schema limited to the object's keys", async t3 => {
			t3.match(lib.StringKey({ a: 1, b: 2 }), { type: "string", enum: ["a", "b"] });
		});
	});

	t1.test("jsonArray()", async t2 => {
		t2.test("wraps the item schema in an array schema", async t3 => {
			t3.strictSame(lib.jsonArray(lib.Note).jsonSchema, { type: "array", items: lib.Note.jsonSchema });
		});
		t2.test("deserialises every item with the item class", async t3 => {
			const notes = lib.jsonArray(lib.Note).fromJSON([
				{ resourceType: "host", resourceId: "1", content: "a" },
				{ resourceType: "host", resourceId: "2", content: "b" },
			] as any);
			t3.ok(notes.every(note => note instanceof lib.Note));
			t3.strictSame(notes.map(note => note.id), ["host/1", "host/2"]);
		});
	});

	t1.test("jsonPrimitive()", async t2 => {
		t2.test("returns the value unchanged", async t3 => {
			t3.strictSame(lib.JsonBoolean.jsonSchema, { type: "boolean" });
			t3.strictSame(lib.JsonNumber.jsonSchema, { type: "number" });
			t3.strictSame(lib.JsonString.jsonSchema, { type: "string" });
			t3.equal(lib.JsonNumber.fromJSON(3), 3);
		});
	});

	t1.test("plainJson()", async t2 => {
		t2.test("uses the schema and returns the value unchanged", async t3 => {
			const schema = lib.Note.jsonSchema;
			const json = { resourceType: "host", resourceId: "1", content: "a" };
			const plain = lib.plainJson(schema);
			t3.equal(plain.jsonSchema, schema);
			t3.equal(plain.fromJSON(json), json);
		});
	});
});
