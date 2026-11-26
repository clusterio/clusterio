import t from "tap";
import * as lib from "@clusterio/lib";

const defaultPermissions = [...lib.permissions.values()].filter(p => p.grantByDefault).map(p => p.name);

t.test("Role", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("defaults to no permissions and not deleted", async t3 => {
			const role = new lib.Role(5, "Name", "Description");
			t3.strictSame(role.permissions, new Set());
			t3.equal(role.updatedAtMs, 0);
			t3.equal(role.isDeleted, false);
		});
	});

	t1.test("toJSON()", async t2 => {
		t2.test("serialises every field", async t3 => {
			const role = new lib.Role(5, "Name", "Description", new Set(["a", "b"]), 10, true);
			t3.strictSame(role.toJSON(), {
				id: 5, name: "Name", description: "Description", permissions: ["a", "b"],
				updated_at_ms: 10, is_deleted: true,
			});
		});
	});

	t1.test("grantDefaultPermissions()", async t2 => {
		t2.test("adds every permission granted by default and keeps others", async t3 => {
			t3.ok(defaultPermissions.length, "lib defines default permissions");
			const role = new lib.Role(5, "Name", "Description", new Set(["custom"]));
			role.grantDefaultPermissions();
			t3.strictSame(role.permissions, new Set(["custom", ...defaultPermissions]));
		});
	});

	t1.test("grantAdminPermissions()", async t2 => {
		t2.test("adds core.admin", async t3 => {
			const role = new lib.Role(5, "Name", "Description", new Set(["custom"]));
			role.grantAdminPermissions();
			t3.strictSame(role.permissions, new Set(["custom", "core.admin"]));
		});
	});

	t1.test("ensureDefaultPlayerRole()", async t2 => {
		t2.test("creates the player role when missing", async t3 => {
			const roles = new lib.SubscribableDatastore<lib.Role>();
			lib.Role.ensureDefaultPlayerRole(roles);
			const role = roles.get(lib.Role.DefaultPlayerRoleId)!;
			t3.equal(role.id, 1);
			t3.equal(role.name, "Player");
			t3.equal(role.description, "Default player role.");
			t3.strictSame(role.permissions, new Set(defaultPermissions));
		});
		t2.test("grants default permissions to an existing player role", async t3 => {
			const existing = new lib.Role(1, "Custom", "Mine", new Set(["custom"]));
			const roles = new lib.SubscribableDatastore<lib.Role>();
			roles.set(existing);
			lib.Role.ensureDefaultPlayerRole(roles);
			t3.equal(roles.get(1), existing);
			t3.equal(existing.name, "Custom");
			t3.strictSame(existing.permissions, new Set(["custom", ...defaultPermissions]));
		});
	});

	t1.test("ensureDefaultAdminRole()", async t2 => {
		t2.test("creates the admin role when missing", async t3 => {
			const roles = new lib.SubscribableDatastore<lib.Role>();
			lib.Role.ensureDefaultAdminRole(roles);
			const role = roles.get(lib.Role.DefaultAdminRoleId)!;
			t3.equal(role.id, 0);
			t3.equal(role.name, "Cluster Admin");
			t3.equal(role.description, "Cluster wide administrator.");
			t3.strictSame(role.permissions, new Set(["core.admin"]));
		});
		t2.test("grants core.admin to an existing admin role", async t3 => {
			const existing = new lib.Role(0, "Custom", "Mine", new Set(["custom"]));
			const roles = new lib.SubscribableDatastore<lib.Role>();
			roles.set(existing);
			lib.Role.ensureDefaultAdminRole(roles);
			t3.equal(roles.get(0), existing);
			t3.strictSame(existing.permissions, new Set(["custom", "core.admin"]));
		});
	});
});
