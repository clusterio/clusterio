import t from "tap";
import * as lib from "@clusterio/lib";

const base = { name: "test", title: "Test" };

t.test("pluginNeedsWebBuild()", async t1 => {
	t1.test("is false for a plugin with nothing for the web", async t2 => {
		t2.equal(lib.pluginNeedsWebBuild(base), false);
		t2.equal(lib.pluginNeedsWebBuild({
			...base, hostEntrypoint: "host", instanceEntrypoint: "instance", ctlEntrypoint: "ctl",
		}), false);
	});
	t1.test("is true for web or controller entrypoints and config fields", async t2 => {
		const fields = { "test.field": { type: "string", initialValue: "" } } as const;
		const cases: Partial<lib.PluginDeclaration>[] = [
			{ webEntrypoint: "web" },
			{ controllerEntrypoint: "controller" },
			{ controllerConfigFields: fields },
			{ hostConfigFields: fields },
			{ instanceConfigFields: fields },
			{ ctlConfigFields: fields },
		];
		for (const extra of cases) {
			t2.equal(lib.pluginNeedsWebBuild({ ...base, ...extra }), true, Object.keys(extra)[0]);
		}
	});
});

t.test("pluginRequiredMods()", async t1 => {
	t1.test("returns an empty list without requiredMods", async t2 => {
		t2.strictSame(lib.pluginRequiredMods(base), []);
	});
	t1.test("parses each entry", async t2 => {
		const mods = lib.pluginRequiredMods({ ...base, requiredMods: ["subspace_storage >= 2.3.0", "clusterio_lib"] });
		t2.equal(mods.length, 2);
		t2.type(mods[0], lib.ModDependency);
		t2.match(mods[0], { name: "subspace_storage", type: "required" });
		t2.ok(mods[0].version!.testVersion("2.3.0" as lib.SourceVersion));
		t2.notOk(mods[0].version!.testVersion("2.2.9" as lib.SourceVersion));
		t2.match(mods[1], { name: "clusterio_lib", type: "required", version: undefined });
	});
	t1.test("rejects dependency prefixes", async t2 => {
		for (const spec of ["? foo", "! foo", "~ foo", "(?) foo"]) {
			t2.throws(
				() => lib.pluginRequiredMods({ ...base, requiredMods: [spec] }),
				new Error(`requiredMods entry "${spec}" can not have a dependency prefix`),
				spec
			);
		}
	});
	t1.test("rejects invalid entries", async t2 => {
		t2.throws(
			() => lib.pluginRequiredMods({ ...base, requiredMods: [""] }),
			{ message: /^Invalid dependency/ }
		);
	});
});
