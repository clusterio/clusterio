import assert from "node:assert/strict";

import * as lib from "@clusterio/lib";
import { computePluginStatuses, planUpdate } from "../../packages/web_ui/src/util/plugin_status.ts";

// Every state a machine can report for the plugin "plugin" published as "pkg", checked against
// what the next startup and npm install would do, independent of the other machines.
const target = "2.0.0";
const versions = ["1.0.0", "2.0.0", "3.0.0"];

function details(fields) {
	const plugin = new lib.PluginDetails(
		fields.name, fields.name, fields.version, fields.loaded, fields.enabled, undefined, fields.npmPackage,
		fields.installedVersion, fields.pendingInstall, fields.removed, fields.dependencyName, fields.noEntrypoint,
		fields.nameTaken,
	);
	return plugin;
}

function* states() {
	yield { label: "absent", plugins: [] };
	for (const version of versions) {
		for (const installed of [version, ...versions.filter(other => other !== version)]) {
			for (const enabled of [true, false]) {
				for (const loaded of enabled ? [true] : [true, false]) {
					const state = `${enabled ? "enabled" : "disabled"}${loaded ? " loaded" : ""}`;
					yield {
						label: `npm ${version} on disk ${installed} ${state}`,
						entry: { source: "npm", version, installed, enabled, loaded },
						plugins: [details({
							name: "plugin", version, loaded, enabled, npmPackage: "pkg",
							installedVersion: installed, dependencyName: "pkg",
						})],
					};
				}
			}
		}
		yield {
			label: `npm ${version} removed`,
			entry: { source: "npm", version, removed: true },
			plugins: [details({
				name: "plugin", version, loaded: true, enabled: true, npmPackage: "pkg",
				removed: true, dependencyName: "pkg",
			})],
		};
		yield {
			label: `npm ${version} no entrypoint`,
			entry: { source: "npm", version, installed: version, noEntrypoint: true },
			plugins: [details({
				name: "plugin", version, loaded: false, enabled: false, npmPackage: "pkg",
				installedVersion: version, dependencyName: "pkg", noEntrypoint: true,
			})],
		};
		yield {
			label: `npm ${version} pending`,
			entry: { source: "npm", version, installed: version, pending: true },
			plugins: [details({
				name: "pkg", version, loaded: false, enabled: false, npmPackage: "pkg",
				installedVersion: version, pendingInstall: true, dependencyName: "pkg",
			})],
		};
		yield {
			label: `alias ${version} pending`,
			entry: { source: "alias", version, installed: version, pending: true },
			plugins: [details({
				name: "pkg", version, loaded: false, enabled: false,
				installedVersion: version, pendingInstall: true, dependencyName: "pkg",
			})],
		};
		yield {
			label: `npm ${version} removed and reinstalled at ${target}`,
			entry: { source: "npm", version, installed: target, replaced: true },
			plugins: [
				details({
					name: "plugin", version, loaded: true, enabled: true, npmPackage: "pkg",
					removed: true, dependencyName: "pkg",
				}),
				details({
					name: "pkg", version: target, loaded: false, enabled: false, npmPackage: "pkg",
					installedVersion: target, pendingInstall: true, dependencyName: "pkg",
				}),
			],
		};
	}
	yield {
		label: "alias loaded as pkg",
		taken: "dependency",
		plugins: [details({
			name: "real_plugin", version: "1.0.0", loaded: true, enabled: true,
			installedVersion: "1.0.0", dependencyName: "pkg",
		})],
	};
	for (const version of versions) {
		yield {
			label: `npm ${version} skipped as its name is taken`,
			taken: "name",
			plugins: [
				details({ name: "plugin", version: "1.0.0", loaded: true, enabled: true, installedVersion: "1.0.0" }),
				details({
					name: "pkg", version, loaded: false, enabled: false, npmPackage: "pkg",
					installedVersion: version, dependencyName: "pkg", nameTaken: true,
				}),
			],
			entry: { source: "npm", version, installed: version },
		};
	}
	yield {
		label: "local plugin with the same name",
		taken: "name",
		plugins: [details({
			name: "plugin", version: "1.0.0", loaded: true, enabled: true, installedVersion: "1.0.0",
		})],
	};
	yield {
		label: "local plugin with the same name and pkg pending",
		taken: "name",
		plugins: [
			details({ name: "plugin", version: "1.0.0", loaded: true, enabled: true, installedVersion: "1.0.0" }),
			details({
				name: "pkg", version: "1.0.0", loaded: false, enabled: false, npmPackage: "pkg",
				installedVersion: "1.0.0", pendingInstall: true, dependencyName: "pkg",
			}),
		],
	};
}

function expectedOperation(state) {
	const { entry, taken } = state;
	const present = entry && !entry.removed;
	if (present && semverGte(entry.installed, target)) {
		return "none";
	}
	if (taken || present && entry.source !== "npm") {
		// Startup would skip it, or npm install pkg would replace the package at that dependency name
		return "skip";
	}
	return !present || entry.pending || entry.replaced ? "install" : "update";
}

function expected(state) {
	const { entry, taken } = state;
	const op = expectedOperation(state);
	if (taken === "name") {
		return { running: undefined, afterRestart: undefined, op };
	}
	let running;
	let afterRestart;
	if (entry?.loaded || entry?.removed || entry?.replaced) {
		running = entry.version;
	}
	if (entry && !entry.removed && !entry.noEntrypoint && (entry.pending || entry.replaced || entry.enabled)) {
		afterRestart = entry.installed;
	}
	return { running, afterRestart, op };
}

function semverGte(a, b) {
	return versions.indexOf(a) >= versions.indexOf(b);
}

const reference = { name: "ref", isController: true, address: "controller", plugins: [details({
	name: "plugin", version: "1.0.0", loaded: true, enabled: true, npmPackage: "pkg",
	installedVersion: "1.0.0", dependencyName: "pkg",
})] };

function actual(machines, name) {
	const status = computePluginStatuses(machines).get("pkg");
	const entry = status.machines.find(machine => machine.name === name);
	const plan = planUpdate(
		status, target, { canInstall: () => true, canUpdate: () => true }, { hasPermission: () => true },
	);
	let op = "none";
	const operation = plan.operations.find(candidate => candidate.target.name === name);
	if (operation) {
		op = operation.kind;
	} else if (plan.skipped.some(skip => skip.text.startsWith(`${name} `))) {
		op = "skip";
	}
	return { running: entry.running, afterRestart: entry.afterRestart, op };
}

describe("web_ui/util/plugin_status matrix", function() {
	const all = [...states()];
	for (const state of all) {
		it(`should predict ${state.label}`, function() {
			const machine = { name: "m", isController: false, address: { hostId: 1 }, plugins: state.plugins };
			const result = actual([reference, machine], "m");
			assert.deepEqual(result, expected(state));
			// Independent of what other machines report
			for (const other of all) {
				const otherMachine = { name: "o", isController: false, address: { hostId: 2 }, plugins: other.plugins };
				assert.deepEqual(actual([reference, otherMachine, machine], "m"), result, other.label);
			}
		});
	}
});
