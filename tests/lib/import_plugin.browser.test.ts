import t from "tap";
import importPlugin from "@clusterio/lib/dist/browser/src/import_plugin.browser.js";

// Stands in for the container the web interface imports from a plugin's static files.
function makeContainer(modules: Record<string, Record<string, any>>) {
	const requested: string[] = [];
	const container = {
		requested,
		async get(entrypoint: string) {
			requested.push(entrypoint);
			if (!(entrypoint in modules)) {
				throw new Error(`Module "${entrypoint}" does not exist in container.`);
			}
			return modules[entrypoint];
		},
	};
	return container;
}

t.test("importPlugin()", async t1 => {
	t1.test("imports the entrypoint from the plugin's container", async t2 => {
		const container = makeContainer({ "./dist/controller.js": { default: 1, named: 2 } });
		const pluginInfo = { name: "test", title: "Test", container };
		const module = await importPlugin(pluginInfo, "./dist/controller.js");
		t2.equal(module.default, 1);
		t2.equal(module.named, 2);
		t2.strictSame(container.requested, ["./dist/controller.js"]);
	});
	t1.test("accepts a container that returns synchronously", async t2 => {
		const module = { default: 1 };
		const pluginInfo = { name: "test", title: "Test", container: { get: () => module } };
		t2.equal(await importPlugin(pluginInfo, "./"), module);
	});
	t1.test("rejects a missing entrypoint", async t2 => {
		const pluginInfo = { name: "test", title: "Test", container: makeContainer({}) };
		await t2.rejects(
			importPlugin(pluginInfo, "./dist/missing.js"),
			new Error("Module \"./dist/missing.js\" does not exist in container."),
		);
	});
});
