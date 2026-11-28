import t from "tap";
import * as lib from "@clusterio/lib";
import { permissionRecorder } from "../../shared/user.ts";

function request(dst: lib.Address) {
	return new lib.MessageRequest(1, new lib.Address(lib.Address.control, 1), dst, "UpdateAllRequest");
}

t.test("UpdateAllRequest", async t1 => {
	t1.test("UpdateAllRequest.permission()", async t2 => {
		t2.test("needs host update permission for a host", async t3 => {
			const { user, checked } = permissionRecorder();
			lib.UpdateAllRequest.permission(user, request(new lib.Address(lib.Address.host, 2)));
			t3.strictSame(checked, ["core.host.update", "core.plugin.update"]);
		});
		t2.test("needs controller update permission for the controller", async t3 => {
			const { user, checked } = permissionRecorder();
			lib.UpdateAllRequest.permission(user, request(new lib.Address(lib.Address.controller, 0)));
			t3.strictSame(checked, ["core.controller.update", "core.plugin.update"]);
		});
		t2.test("throws when a permission is denied", async t3 => {
			const { user } = permissionRecorder("core.plugin.update");
			t3.throws(
				() => lib.UpdateAllRequest.permission(user, request(new lib.Address(lib.Address.controller, 0))),
				new lib.PermissionError("Permission denied"),
			);
		});
	});
});
