import path from "node:path";
import t from "tap";
import importPlugin from "@clusterio/lib/dist/node/src/import_plugin.node.js";

t.test("importPlugin()", async t1 => {
	const dir = t1.testdir({
		"package.json": "{ \"type\": \"module\" }",
		dist: { "controller.js": "export default 1; export const named = 2;" },
	});
	const pluginInfo = { name: "test", title: "Test", packagePath: path.join(dir, "package.json") };

	t1.test("imports the entrypoint relative to the package", async t2 => {
		const module = await importPlugin(pluginInfo, "dist/controller.js");
		t2.equal(module.default, 1);
		t2.equal(module.named, 2);
	});
	t1.test("rejects a missing entrypoint", async t2 => {
		await t2.rejects(importPlugin(pluginInfo, "dist/missing.js"), { code: "ERR_MODULE_NOT_FOUND" });
	});
});
