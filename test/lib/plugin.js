import assert from "node:assert/strict";

import * as lib from "@clusterio/lib";


describe("lib/plugin", function() {
	describe("pluginNeedsWebBuild()", function() {
		it("should be false for plugins with only host, instance or ctl code", function() {
			assert.equal(lib.pluginNeedsWebBuild({ name: "foo", title: "Foo" }), false);
			assert.equal(lib.pluginNeedsWebBuild({
				name: "foo", title: "Foo", hostEntrypoint: "host.js", instanceEntrypoint: "instance.js",
				ctlEntrypoint: "ctl.js", messages: [],
			}), false);
		});
		it("should be true for plugins with web or controller code or config fields", function() {
			assert.equal(lib.pluginNeedsWebBuild({ name: "foo", title: "Foo", webEntrypoint: "web.js" }), true);
			assert.equal(lib.pluginNeedsWebBuild({
				name: "foo", title: "Foo", controllerEntrypoint: "controller.js",
			}), true);
			for (const field of [
				"controllerConfigFields", "hostConfigFields", "instanceConfigFields", "ctlConfigFields",
			]) {
				assert.equal(lib.pluginNeedsWebBuild({ name: "foo", title: "Foo", [field]: {} }), true, field);
			}
		});
	});
	describe("pluginRequiredMods()", function() {
		it("should parse dependency strings", function() {
			const mods = lib.pluginRequiredMods({
				name: "foo", title: "Foo", requiredMods: ["bar", "baz >= 1.2.0", "baz < 2.0.0"],
			});
			assert.deepEqual(mods.map(mod => [mod.name, mod.version?.toString()]), [
				["bar", undefined], ["baz", ">= 1.2.0"], ["baz", "< 2.0.0"],
			]);
		});
		it("should return an empty list without requiredMods", function() {
			assert.deepEqual(lib.pluginRequiredMods({ name: "foo", title: "Foo" }), []);
		});
		it("should reject dependency prefixes and invalid versions", function() {
			for (const spec of ["? bar", "! bar", "~ bar", "bar >= 1..2"]) {
				assert.throws(() => lib.pluginRequiredMods({ name: "foo", title: "Foo", requiredMods: [spec] }));
			}
		});
	});
});
