import fs from "node:fs/promises";
import path from "node:path";
import t from "tap";
import * as lib from "@clusterio/lib";

t.test("mapToObject()", async t1 => {
	t1.test("converts a string keyed map", async t2 => {
		t2.strictSame(lib.mapToObject(new Map([["a", 1], ["b", 2]])), { a: 1, b: 2 });
	});
	t1.test("converts an empty map", async t2 => {
		t2.strictSame(lib.mapToObject(new Map()), {});
	});
	t1.test("keeps a __proto__ key as an own property", async t2 => {
		const obj = lib.mapToObject(new Map([["__proto__", { polluted: true }]]));
		t2.strictSame(Object.keys(obj), ["__proto__"]);
	});
	t1.test("rejects non-string keys", async t2 => {
		t2.throws(
			() => lib.mapToObject(new Map<any, number>([[1, 1]])),
			new Error("Expected all keys to be string but got number")
		);
	});
});

t.test("loadJsonAsMap()", async t1 => {
	t1.test("loads an object as a map", async t2 => {
		const dir = t2.testdir({ "file.json": JSON.stringify({ a: 1, b: { c: 2 } }) });
		const map = await lib.loadJsonAsMap(path.join(dir, "file.json"));
		t2.strictSame([...map], [["a", 1], ["b", { c: 2 }]]);
	});
	t1.test("returns an empty map if the file does not exist", async t2 => {
		const dir = t2.testdir({});
		const map = await lib.loadJsonAsMap(path.join(dir, "missing.json"));
		t2.equal(map.size, 0);
	});
	t1.test("rejects content that is not an object", async t2 => {
		const dir = t2.testdir({ "array.json": "[1]", "null.json": "null" });
		await t2.rejects(lib.loadJsonAsMap(path.join(dir, "array.json")), new Error("Expected object but got array"));
		await t2.rejects(lib.loadJsonAsMap(path.join(dir, "null.json")), new Error("Expected object but got null"));
	});
	t1.test("rejects invalid JSON", async t2 => {
		const dir = t2.testdir({ "file.json": "{" });
		await t2.rejects(lib.loadJsonAsMap(path.join(dir, "file.json")), { name: "SyntaxError" });
	});
	t1.test("rethrows read errors other than a missing file", async t2 => {
		const dir = t2.testdir({ "dir.json": {} });
		await t2.rejects(lib.loadJsonAsMap(path.join(dir, "dir.json")), { code: "EISDIR" });
	});
});

t.test("saveMapAsJson()", async t1 => {
	t1.test("writes the map as a JSON object", async t2 => {
		const dir = t2.testdir({});
		const file = path.join(dir, "file.json");
		await lib.saveMapAsJson(file, new Map<string, unknown>([["a", 1], ["b", [2]]]));
		t2.strictSame(JSON.parse(await fs.readFile(file, "utf8")), { a: 1, b: [2] });
	});
	t1.test("creates missing directories", async t2 => {
		const dir = t2.testdir({});
		const file = path.join(dir, "sub", "dir", "file.json");
		await lib.saveMapAsJson(file, new Map([["a", 1]]));
		t2.strictSame(JSON.parse(await fs.readFile(file, "utf8")), { a: 1 });
	});
	t1.test("round trips through loadJsonAsMap", async t2 => {
		const dir = t2.testdir({});
		const file = path.join(dir, "file.json");
		const map = new Map<string, unknown>([["x", { y: "z" }], ["n", null]]);
		await lib.saveMapAsJson(file, map);
		t2.strictSame(await lib.loadJsonAsMap(file), map);
	});
	t1.test("rejects non-string keys without writing", async t2 => {
		const dir = t2.testdir({});
		const file = path.join(dir, "file.json");
		await t2.rejects(
			lib.saveMapAsJson(file, new Map<any, unknown>([[1, 1]])),
			new Error("Expected all keys to be string but got number")
		);
		t2.strictSame(await fs.readdir(dir), []);
	});
});

t.test("loadJsonArrayAsMap()", async t1 => {
	t1.test("loads an array keyed by id", async t2 => {
		const dir = t2.testdir({ "file.json": JSON.stringify([{ id: 1, v: "a" }, { id: "x", v: "b" }]) });
		const map = await lib.loadJsonArrayAsMap(path.join(dir, "file.json"));
		t2.strictSame([...map], [[1, { id: 1, v: "a" }], ["x", { id: "x", v: "b" }]]);
	});
	t1.test("returns an empty map if the file does not exist", async t2 => {
		const dir = t2.testdir({});
		t2.equal((await lib.loadJsonArrayAsMap(path.join(dir, "missing.json"))).size, 0);
	});
	t1.test("rejects content that is not an array", async t2 => {
		const dir = t2.testdir({ "file.json": "{}" });
		await t2.rejects(
			lib.loadJsonArrayAsMap(path.join(dir, "file.json")),
			new Error("Expected array but got object")
		);
	});
	t1.test("rejects elements that are not objects", async t2 => {
		const dir = t2.testdir({ "number.json": "[1]", "null.json": "[null]", "array.json": "[[]]" });
		for (const name of ["number.json", "null.json", "array.json"]) {
			await t2.rejects(
				lib.loadJsonArrayAsMap(path.join(dir, name)),
				new Error("Expected all elements to be objects"),
				name
			);
		}
	});
	t1.test("rejects elements without an id", async t2 => {
		const dir = t2.testdir({ "file.json": JSON.stringify([{ id: 1 }, { name: "a" }]) });
		await t2.rejects(
			lib.loadJsonArrayAsMap(path.join(dir, "file.json")),
			new Error("Expected all elements to have an id property")
		);
	});
	t1.test("rethrows read errors other than a missing file", async t2 => {
		const dir = t2.testdir({ "dir.json": {} });
		await t2.rejects(lib.loadJsonArrayAsMap(path.join(dir, "dir.json")), { code: "EISDIR" });
	});
});

t.test("saveMapAsJsonArray()", async t1 => {
	t1.test("writes the values as a JSON array", async t2 => {
		const dir = t2.testdir({});
		const file = path.join(dir, "sub", "file.json");
		const map = new Map([[1, { id: 1, v: "a" }], [2, { id: 2, v: "b" }]]);
		await lib.saveMapAsJsonArray(file, map);
		t2.strictSame(JSON.parse(await fs.readFile(file, "utf8")), [{ id: 1, v: "a" }, { id: 2, v: "b" }]);
		t2.strictSame(await lib.loadJsonArrayAsMap(file), map);
	});
});

t.test("ItemDatabase", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("creates an empty database", async t3 => {
			const db = new lib.ItemDatabase();
			t3.equal(db.size, 0);
			t3.strictSame(db.serialize(), {});
		});
		t2.test("restores a serialized database", async t3 => {
			const db = new lib.ItemDatabase({ "iron-plate": { normal: 10, rare: 2 } });
			t3.equal(db.size, 1);
			t3.equal(db.getItemCount("iron-plate", "normal"), 10);
			t3.equal(db.getItemCount("iron-plate", "rare"), 2);
		});
		t2.test("migrates counts without quality to normal", async t3 => {
			const db = new lib.ItemDatabase({ "iron-plate": 10 });
			t3.strictSame(db.serialize(), { "iron-plate": { normal: 10 } });
		});
		t2.test("rejects counts that are not numbers", async t3 => {
			t3.throws(() => new lib.ItemDatabase({ a: { normal: "1" } }), new Error("count must be a number"));
			t3.throws(() => new lib.ItemDatabase({ a: { normal: NaN } }), new Error("count must be a number"));
			t3.throws(() => new lib.ItemDatabase({ a: "1" }), new Error("count must be a number"));
		});
	});

	t1.test("serialize()", async t2 => {
		t2.test("drops zero counts and items with only zero counts", async t3 => {
			const db = new lib.ItemDatabase({ a: { normal: 0, rare: 3 }, b: { normal: 0 } });
			t3.strictSame(db.serialize(), { a: { rare: 3 } });
			t3.equal(db.size, 2, "size counts zero entries");
		});
		t2.test("keeps negative counts", async t3 => {
			const db = new lib.ItemDatabase();
			db.removeItem("a", 5, "normal");
			t3.strictSame(db.serialize(), { a: { normal: -5 } });
		});
	});

	t1.test("getItemCount()", async t2 => {
		t2.test("returns 0 for unknown items and qualities", async t3 => {
			const db = new lib.ItemDatabase({ a: { normal: 1 } });
			t3.equal(db.getItemCount("b", "normal"), 0);
			t3.equal(db.getItemCount("a", "rare"), 0);
		});
		t2.test("rejects invalid arguments", async t3 => {
			const db = new lib.ItemDatabase();
			t3.throws(() => db.getItemCount(1 as any, "normal"), new Error("name must be a string"));
			t3.throws(() => db.getItemCount("a", 1 as any), new Error("quality must be a string"));
		});
	});

	t1.test("addItem()", async t2 => {
		t2.test("adds to new and existing items and qualities", async t3 => {
			const db = new lib.ItemDatabase();
			db.addItem("a", 2, "normal");
			db.addItem("a", 3, "normal");
			db.addItem("a", 4, "rare");
			t3.equal(db.getItemCount("a", "normal"), 5);
			t3.equal(db.getItemCount("a", "rare"), 4);
		});
		t2.test("rejects invalid arguments", async t3 => {
			const db = new lib.ItemDatabase();
			t3.throws(() => db.addItem(null as any, 1, "normal"), new Error("name must be a string"));
			t3.throws(() => db.addItem("a", "1" as any, "normal"), new Error("count must be a number"));
			t3.throws(() => db.addItem("a", NaN, "normal"), new Error("count must be a number"));
			t3.throws(() => db.addItem("a", 1, undefined as any), new Error("quality must be a string"));
			t3.equal(db.size, 0);
		});
	});

	t1.test("removeItem()", async t2 => {
		t2.test("subtracts from the stored count", async t3 => {
			const db = new lib.ItemDatabase({ a: { normal: 5 } });
			db.removeItem("a", 2, "normal");
			t3.equal(db.getItemCount("a", "normal"), 3);
		});
		t2.test("rejects invalid counts", async t3 => {
			const db = new lib.ItemDatabase({ a: { normal: 5 } });
			t3.throws(() => db.removeItem("a", "2" as any, "normal"), new Error("count must be a number"));
			t3.equal(db.getItemCount("a", "normal"), 5);
		});
	});

	t1.test("getEntries()", async t2 => {
		t2.test("iterates over stored items", async t3 => {
			const db = new lib.ItemDatabase({ a: { normal: 1 }, b: 2 });
			t3.strictSame([...db.getEntries()], [["a", { normal: 1 }], ["b", { normal: 2 }]]);
		});
	});
});
