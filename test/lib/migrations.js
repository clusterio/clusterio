import assert from "node:assert/strict";

import * as lib from "@clusterio/lib";


describe("lib/migrations", function() {
	describe("renameConfigField()", function() {
		it("should move the value to the new name", function() {
			const config = { "foo.bar": 1, "foo.other": 2 };
			assert.equal(lib.renameConfigField(config, "foo.bar", "foo.bar_baz"), config);
			assert.deepEqual(config, { "foo.bar_baz": 1, "foo.other": 2 });
		});
		it("should keep an existing value under the new name", function() {
			const config = { "foo.bar": 1, "foo.bar_baz": 2 };
			lib.renameConfigField(config, "foo.bar", "foo.bar_baz");
			assert.deepEqual(config, { "foo.bar_baz": 2 });
		});
		it("should do nothing if the old name is missing", function() {
			const config = { "foo.bar_baz": 2 };
			lib.renameConfigField(config, "foo.bar", "foo.bar_baz");
			assert.deepEqual(config, { "foo.bar_baz": 2 });
		});
	});
	describe("renameConfigPrefix()", function() {
		it("should rename all fields with the prefix", function() {
			const config = { "old.load_plugin": false, "old.value": 1, "old_other.value": 2 };
			lib.renameConfigPrefix(config, "old.", "new.");
			assert.deepEqual(config, { "new.load_plugin": false, "new.value": 1, "old_other.value": 2 });
		});
	});
	describe("renamePermission()", function() {
		it("should rename the permission", function() {
			const role = { permissions: ["foo.run", "foo.view"] };
			assert.equal(lib.renamePermission(role, "foo.run", "foo.frobnicate"), role);
			assert.deepEqual(role.permissions, ["foo.frobnicate", "foo.view"]);
		});
		it("should not duplicate a permission the role already has", function() {
			const role = { permissions: ["foo.run", "foo.frobnicate"] };
			lib.renamePermission(role, "foo.run", "foo.frobnicate");
			assert.deepEqual(role.permissions, ["foo.frobnicate"]);
		});
	});
	describe("renamePermissionPrefix()", function() {
		it("should rename all permissions with the prefix", function() {
			const role = { permissions: ["old.view", "old_other.view", "core.admin"] };
			lib.renamePermissionPrefix(role, "old.", "new.");
			assert.deepEqual(role.permissions, ["new.view", "old_other.view", "core.admin"]);
		});
	});
});
