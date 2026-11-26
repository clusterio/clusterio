import t from "tap";
import * as lib from "@clusterio/lib";
import { permissionRecorder } from "../../shared/user.ts";

function save(overrides: Partial<lib.SaveDetails> = {}) {
	const s = new lib.SaveDetails(1, "file", "world.zip", 100, 2000, false, true, 3000, false);
	return Object.assign(s, overrides);
}

function request(data: unknown) {
	return new lib.MessageRequest(
		1, new lib.Address(lib.Address.control, 1), new lib.Address(lib.Address.controller, 0),
		"InstanceTransferSaveRequest", data,
	);
}

t.test("SaveDetails", async t1 => {
	t1.test("id", async t2 => {
		t2.test("joins instance id and name", async t3 => {
			t3.equal(save().id, "1/world.zip");
		});
	});
	t1.test("equals()", async t2 => {
		t2.test("is true for identical saves", async t3 => {
			t3.equal(save().equals(save()), true);
		});
		t2.test("ignores updatedAtMs", async t3 => {
			t3.equal(save().equals(save({ updatedAtMs: 0 })), true);
		});
		t2.test("is false when any other field differs", async t3 => {
			const changes: Partial<lib.SaveDetails>[] = [
				{ instanceId: 2 }, { type: "directory" }, { name: "other.zip" }, { size: 1 },
				{ mtimeMs: 1 }, { loaded: true }, { loadByDefault: false }, { isDeleted: true },
			];
			for (const change of changes) {
				t3.equal(save().equals(save(change)), false, Object.keys(change)[0]);
			}
		});
	});
});

t.test("InstanceTransferSaveRequest", async t1 => {
	t1.test("InstanceTransferSaveRequest.permission()", async t2 => {
		const transfer = "core.instance.save.transfer";
		t2.test("needs copy permission to copy", async t3 => {
			const { user, checked } = permissionRecorder();
			lib.InstanceTransferSaveRequest.permission(user, request({ copy: true, sourceName: "a", targetName: "a" }));
			t3.strictSame(checked, [transfer, "core.instance.save.copy"]);
		});
		t2.test("needs rename permission to move under a new name", async t3 => {
			const { user, checked } = permissionRecorder();
			const data = { copy: false, sourceName: "a", targetName: "b" };
			lib.InstanceTransferSaveRequest.permission(user, request(data));
			t3.strictSame(checked, [transfer, "core.instance.save.rename"]);
		});
		t2.test("needs only transfer permission to move under the same name", async t3 => {
			const { user, checked } = permissionRecorder();
			const data = { copy: false, sourceName: "a", targetName: "a" };
			lib.InstanceTransferSaveRequest.permission(user, request(data));
			t3.strictSame(checked, [transfer]);
		});
		t2.test("checks only transfer permission without data", async t3 => {
			const { user, checked } = permissionRecorder();
			lib.InstanceTransferSaveRequest.permission(user, request(null));
			t3.strictSame(checked, [transfer]);
		});
		t2.test("throws when a permission is denied", async t3 => {
			const { user } = permissionRecorder("core.instance.save.copy");
			t3.throws(
				() => lib.InstanceTransferSaveRequest.permission(
					user, request({ copy: true, sourceName: "a", targetName: "a" }),
				),
				new lib.PermissionError("Permission denied"),
			);
		});
	});
});
