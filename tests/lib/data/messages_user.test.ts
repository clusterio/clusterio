import t from "tap";
import * as lib from "@clusterio/lib";
import { permissionRecorder } from "../../shared/user.ts";

function request(data: unknown) {
	return new lib.MessageRequest(
		1, new lib.Address(lib.Address.control, 1), new lib.Address(lib.Address.controller, 0),
		"UserBulkImportRequest", data,
	);
}

t.test("UserBulkImportRequest", async t1 => {
	t1.test("UserBulkImportRequest.permission()", async t2 => {
		const cases: [string, string[]][] = [
			["users", ["core.user.set_admin", "core.user.set_banned", "core.user.set_whitelisted"]],
			["admins", ["core.user.set_admin"]],
			["bans", ["core.user.set_banned"]],
			["whitelist", ["core.user.set_whitelisted"]],
		];
		for (const [importType, permissions] of cases) {
			t2.test(`checks the permissions to import ${importType}`, async t3 => {
				const { user, checked } = permissionRecorder();
				lib.UserBulkImportRequest.permission(user, request({ importType, users: [] }));
				t3.strictSame(checked, ["core.user.bulk_import", ...permissions]);
			});
		}
		t2.test("needs bulk restore permission to restore", async t3 => {
			const { user, checked } = permissionRecorder();
			lib.UserBulkImportRequest.permission(user, request({ importType: "bans", users: [], restore: true }));
			t3.strictSame(checked, ["core.user.bulk_restore", "core.user.set_banned"]);
		});
		t2.test("rejects an unknown import type with a ValidationError", async t3 => {
			const { user } = permissionRecorder();
			t3.throws(
				() => lib.UserBulkImportRequest.permission(user, request({ importType: "mods", users: [] })),
				new lib.ValidationError("Unknown import / restore type: mods"),
			);
		});
		t2.test("checks nothing without data", async t3 => {
			const { user, checked } = permissionRecorder();
			lib.UserBulkImportRequest.permission(user, request(undefined));
			t3.strictSame(checked, []);
		});
		t2.test("throws when a permission is denied", async t3 => {
			const { user } = permissionRecorder("core.user.bulk_import");
			t3.throws(
				() => lib.UserBulkImportRequest.permission(user, request({ importType: "users", users: [] })),
				new lib.PermissionError("Permission denied"),
			);
		});
	});
});
