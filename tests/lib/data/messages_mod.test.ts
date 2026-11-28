import t from "tap";
import * as lib from "@clusterio/lib";

function pack() {
	return lib.ModPack.fromJSON({
		name: "p", description: "", factorio_version: "2.0.11",
		mods: [
			{ name: "a", enabled: true, version: "1.2.3" as lib.SourceVersion },
			{ name: "b", enabled: false, version: "0.1.0" as lib.SourceVersion },
		],
		settings: { "startup": {}, "runtime-global": {}, "runtime-per-user": {} },
	});
}

t.test("ModDependencyResolveRequest", async t1 => {
	t1.test("ModDependencyResolveRequest.fromModPack()", async t2 => {
		t2.test("pins every mod to its exact version", async t3 => {
			const request = lib.ModDependencyResolveRequest.fromModPack(pack());
			t3.strictSame(request.mods.map(m => m.spec), [
				"a = 1.2.3", "b = 0.1.0", "base = 2.0.11", "elevated-rails = 2.0.11", "quality = 2.0.11",
				"space-age = 2.0.11",
			]);
			t3.equal(request.factorioVersion, "2.0");
			t3.equal(request.checkForUpdates, false);
		});
		t2.test("allows newer versions when checking for updates", async t3 => {
			const request = lib.ModDependencyResolveRequest.fromModPack(pack(), true);
			t3.equal(request.mods[0].spec, "a >= 1.2.3");
			t3.equal(request.checkForUpdates, true);
		});
	});
	t1.test("ModDependencyResolveRequest.fromModPackEnabled()", async t2 => {
		t2.test("includes only enabled mods", async t3 => {
			const request = lib.ModDependencyResolveRequest.fromModPackEnabled(pack());
			t3.strictSame(request.mods.map(m => m.spec), ["a = 1.2.3", "base = 2.0.11"]);
			t3.equal(request.factorioVersion, "2.0");
		});
		t2.test("allows newer versions when checking for updates", async t3 => {
			const request = lib.ModDependencyResolveRequest.fromModPackEnabled(pack(), true);
			t3.strictSame(request.mods.map(m => m.spec), ["a >= 1.2.3", "base >= 2.0.11"]);
			t3.equal(request.checkForUpdates, true);
		});
	});
});
