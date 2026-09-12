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
				"controllerConfigFields", "hostConfigFields", "instanceConfigFields", "controlConfigFields",
			]) {
				assert.equal(lib.pluginNeedsWebBuild({ name: "foo", title: "Foo", [field]: {} }), true, field);
			}
		});
	});
});
