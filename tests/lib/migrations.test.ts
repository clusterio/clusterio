import t from "tap";
import * as lib from "@clusterio/lib";

function role(permissions: string[]) {
	return { id: 1, name: "Role", description: "", permissions };
}

t.test("renameConfigField()", async t1 => {
	t1.test("moves the value to the new name", async t2 => {
		const config = { "a.old": 1, "b": 2 };
		const result = lib.renameConfigField(config, "a.old", "a.new");
		t2.equal(result, config);
		t2.strictSame(config, { "b": 2, "a.new": 1 });
	});
	t1.test("keeps an existing new field and drops the old one", async t2 => {
		const config = { "a.old": 1, "a.new": 2 };
		lib.renameConfigField(config, "a.old", "a.new");
		t2.strictSame(config, { "a.new": 2 });
	});
	t1.test("does nothing if the old field is missing", async t2 => {
		const config = { "a.new": 2 };
		lib.renameConfigField(config, "a.old", "a.new");
		t2.strictSame(config, { "a.new": 2 });
	});
	t1.test("ignores inherited properties", async t2 => {
		const config = { b: 1 };
		lib.renameConfigField(config, "toString", "a");
		t2.strictSame(config, { b: 1 });
	});
	t1.test("keeps the field when renamed to itself", async t2 => {
		const config = { a: 1 };
		lib.renameConfigField(config, "a", "a");
		t2.strictSame(config, { a: 1 });
	});
});

t.test("renameConfigPrefix()", async t1 => {
	t1.test("renames every field with the prefix", async t2 => {
		const config = { "inventory_sync.a": 1, "inventory_sync.b": 2, "other.a": 3 };
		const result = lib.renameConfigPrefix(config, "inventory_sync.", "player_sync.");
		t2.equal(result, config);
		t2.strictSame(config, { "other.a": 3, "player_sync.a": 1, "player_sync.b": 2 });
	});
	t1.test("keeps fields that already exist under the new prefix", async t2 => {
		const config = { "old.a": 1, "new.a": 2, "old.b": 3 };
		lib.renameConfigPrefix(config, "old.", "new.");
		t2.strictSame(config, { "new.a": 2, "new.b": 3 });
	});
});

t.test("renamePermission()", async t1 => {
	t1.test("renames a matching permission only", async t2 => {
		const serialized = role(["a.old", "a.other"]);
		const result = lib.renamePermission(serialized, "a.old", "a.new");
		t2.equal(result, serialized);
		t2.strictSame(serialized.permissions, ["a.new", "a.other"]);
	});
	t1.test("merges with an existing permission of the new name", async t2 => {
		const serialized = role(["a.old", "a.new"]);
		lib.renamePermission(serialized, "a.old", "a.new");
		t2.strictSame(serialized.permissions, ["a.new"]);
	});
});

t.test("renamePermissionPrefix()", async t1 => {
	t1.test("renames every permission with the prefix", async t2 => {
		const serialized = role(["inventory_sync.a", "core.b", "inventory_sync.c"]);
		const result = lib.renamePermissionPrefix(serialized, "inventory_sync.", "player_sync.");
		t2.equal(result, serialized);
		t2.strictSame(serialized.permissions, ["player_sync.a", "core.b", "player_sync.c"]);
	});
	t1.test("merges duplicates created by the rename", async t2 => {
		const serialized = role(["old.a", "new.a"]);
		lib.renamePermissionPrefix(serialized, "old.", "new.");
		t2.strictSame(serialized.permissions, ["new.a"]);
	});
});
