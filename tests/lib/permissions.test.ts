import t from "tap";
import * as lib from "@clusterio/lib";

// Permissions are registered in a module level map, so each test uses its own names.
function def(name: string, extra: Partial<lib.PermissionDefinition> = {}) {
	return { name: name as lib.PermissionName, title: "Title", description: "Description", ...extra };
}

function pluginInfo(name: string, permissions?: lib.PermissionDefinition[]) {
	return { name, title: name, permissions } as lib.PluginNodeEnvInfo;
}

t.test("corePermissions", async t1 => {
	t1.test("are all defined on import", async t2 => {
		for (const core of lib.corePermissions) {
			const permission = lib.permissions.get(core.name);
			t2.type(permission, lib.Permission);
			t2.equal(permission!.title, core.title);
			t2.equal(permission!.grantByDefault, "grantByDefault" in core && core.grantByDefault);
		}
	});
});

t.test("definePermission()", async t1 => {
	t1.test("adds the permission to the registry", async t2 => {
		lib.definePermission(def("test.define"));
		t2.strictSame(lib.permissions.get("test.define" as lib.PermissionName), new lib.Permission(
			"test.define", "Title", "Description", false
		));
	});
	t1.test("keeps grantByDefault", async t2 => {
		lib.definePermission(def("test.granted", { grantByDefault: true }));
		t2.equal(lib.permissions.get("test.granted")!.grantByDefault, true);
	});
	t1.test("rejects invalid definitions", async t2 => {
		const cases: [Record<string, unknown>, string][] = [
			[{ name: "" }, "Expected name to be a non-empty string"],
			[{ name: 1 }, "Expected name to be a non-empty string"],
			[{ title: "" }, "Expected title to be a non-empty string"],
			[{ title: undefined }, "Expected title to be a non-empty string"],
			[{ description: "" }, "Expected description to be a non-empty string"],
			[{ description: 1 }, "Expected description to be a non-empty string"],
			[{ grantByDefault: "yes" }, "Expected grantByDefault to be a boolean"],
		];
		for (const [extra, message] of cases) {
			t2.throws(
				() => lib.definePermission(def("test.invalid", extra as any)),
				new Error(message),
				JSON.stringify(extra)
			);
		}
		t2.notOk(lib.permissions.has("test.invalid"));
	});
	t1.test("rejects a name that is already defined", async t2 => {
		lib.definePermission(def("test.duplicate"));
		t2.throws(
			() => lib.definePermission(def("test.duplicate", { title: "Other" })),
			new Error("Permission 'test.duplicate' is already defined")
		);
		t2.equal(lib.permissions.get("test.duplicate")!.title, "Title");
	});
});

t.test("registerPluginPermissions()", async t1 => {
	t1.test("defines the permissions of every plugin", async t2 => {
		lib.registerPluginPermissions([
			pluginInfo("alpha", [def("alpha.one"), def("alpha.two", { grantByDefault: true })]),
			pluginInfo("beta", [def("beta.one")]),
		]);
		t2.ok(lib.permissions.has("alpha.one"));
		t2.equal(lib.permissions.get("alpha.two")!.grantByDefault, true);
		t2.ok(lib.permissions.has("beta.one"));
	});
	t1.test("skips plugins without permissions", async t2 => {
		const before = lib.permissions.size;
		lib.registerPluginPermissions([pluginInfo("gamma"), pluginInfo("delta", [])]);
		t2.equal(lib.permissions.size, before);
	});
	t1.test("rejects names without the plugin prefix", async t2 => {
		t2.throws(
			() => lib.registerPluginPermissions([pluginInfo("eps", [def("other.one")])]),
			new Error("Expected name of permission 'other.one' for eps to start with 'eps.'")
		);
		t2.throws(
			() => lib.registerPluginPermissions([pluginInfo("eps", [def("epsilon.one")])]),
			new Error("Expected name of permission 'epsilon.one' for eps to start with 'eps.'")
		);
		t2.throws(
			() => lib.registerPluginPermissions([pluginInfo("eps", [def(1 as any)])]),
			new Error("Expected name of permission '1' for eps to start with 'eps.'")
		);
		t2.notOk(lib.permissions.has("other.one"));
	});
});
