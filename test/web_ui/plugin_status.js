import assert from "node:assert/strict";

import * as lib from "@clusterio/lib";
import { computePluginStatuses, planUpdate } from "../../packages/web_ui/src/util/plugin_status.ts";

describe("web_ui/util/plugin_status", function() {
	describe("planUpdate()", function() {
		const access = { canInstall: () => true, canUpdate: () => true };
		const account = { hasPermission: () => true };
		function machine(name, plugins) {
			return { name, isController: false, address: { hostId: name.length }, plugins };
		}
		function loaded(npmPackage, version) {
			return new lib.PluginDetails("plugin", "Plugin", version, true, true, undefined, npmPackage, version);
		}
		function pending(packageName, npmPackage, version) {
			return new lib.PluginDetails(
				packageName, packageName, version, false, false, undefined, npmPackage, version, true,
			);
		}
		function plan(machines) {
			const statuses = computePluginStatuses(machines);
			assert.equal(statuses.size, 1);
			const status = [...statuses.values()][0];
			return planUpdate(status, "2.0.0", access, account);
		}

		it("should install on machines where the plugin is missing", function() {
			const result = plan([machine("a", [loaded("plugin-aliased", "1.0.0")]), machine("b", [])]);
			assert.deepEqual(result.operations.map(op => [op.kind, op.target.name, op.packageSpec]), [
				["update", "a", "plugin-aliased@2.0.0"],
				["install", "b", "plugin-aliased@2.0.0"],
			]);
		});

		it("should not install over a pending alias with another machine's package", function() {
			const result = plan([
				machine("a", [loaded("plugin-aliased", "2.0.0")]),
				machine("b", [pending("plugin-aliased", undefined, "1.0.0")]),
			]);
			assert.deepEqual(result.operations, []);
			assert.deepEqual(result.skipped, [{ kind: "install", text: "b (not installed from npm)" }]);
		});

		it("should not update a loaded package that isn't from npm", function() {
			const result = plan([
				machine("a", [loaded("plugin-aliased", "1.0.0")]),
				machine("b", [new lib.PluginDetails("plugin-aliased", "Plugin", "1.0.0", true, true)]),
			]);
			assert.deepEqual(result.operations.map(op => op.target.name), ["a"]);
			assert.deepEqual(result.skipped, [{ kind: "update", text: "b (not installed from npm)" }]);
		});

		it("should not install over a loaded alias that has the package name", function() {
			const alias = new lib.PluginDetails("real_plugin", "Real", "1.0.0", true, true);
			alias.dependencyName = "plugin-aliased";
			const statuses = computePluginStatuses([
				machine("a", [loaded("plugin-aliased", "1.0.0")]),
				machine("b", [alias]),
			]);
			const result = planUpdate(statuses.get("plugin-aliased"), "2.0.0", access, account);
			assert.deepEqual(result.operations.map(op => op.target.name), ["a"]);
			assert.deepEqual(result.skipped, [
				{ kind: "install", text: "b (another package is installed as plugin-aliased)" },
			]);
		});

		it("should install over a pending npm package", function() {
			const result = plan([
				machine("a", [loaded("plugin-aliased", "2.0.0")]),
				machine("b", [pending("plugin-aliased", "plugin-aliased", "1.0.0")]),
			]);
			assert.deepEqual(result.operations.map(op => [op.kind, op.target.name]), [["install", "b"]]);
		});
	});
	describe("computePluginStatuses()", function() {
		it("should not expect a plugin without an entrypoint for the machine to run after restart", function() {
			const plugin = new lib.PluginDetails("controller_only", "Plugin", "1.0.0", false, false);
			plugin.noEntrypoint = true;
			const [status] = computePluginStatuses([
				{ name: "host", isController: false, address: { hostId: 1 }, plugins: [plugin] },
			]).values();
			const [entry] = status.machines;
			assert.equal(entry.noEntrypoint, true);
			assert.equal(entry.disabled, false);
			assert.equal(entry.running, undefined);
			assert.equal(entry.afterRestart, undefined);
		});
	});
});
