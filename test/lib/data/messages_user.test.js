import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";

describe("lib/data/messages_user", function() {
	describe("UserBulkImportRequest", function() {
		// A user that grants every permission, so only the importType switch
		// can reject the request.
		function grantAllUser() {
			const checked = [];
			return { checked, checkPermission(permission) { checked.push(permission); } };
		}

		it("should deny an unknown importType with a PermissionError", function() {
			const user = grantAllUser();
			assert.throws(
				() => lib.UserBulkImportRequest.permission(user, { data: { importType: "foo", users: [] } }),
				lib.PermissionError,
			);
		});

		it("should check permissions for a known importType", function() {
			const user = grantAllUser();
			lib.UserBulkImportRequest.permission(user, { data: { importType: "admins", users: [] } });
			assert.deepEqual(user.checked, ["core.user.bulk_import", "core.user.set_admin"]);
		});
	});
});
