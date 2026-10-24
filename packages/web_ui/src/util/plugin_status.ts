import semver from "semver";

import type * as lib from "@clusterio/lib";

import type { UserAccount } from "../BaseWebPlugin";
import type { InstallTarget, PackageOperation, RemoteAccess } from "../components/PluginInstall";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

export type Machine = {
	name: string,
	isController: boolean,
	address: lib.AddressShorthand,
	/** A host that isn't connected, its plugins are the ones it had when last seen */
	offline?: boolean,
};
export type MachinePlugins = Machine & { plugins: lib.PluginDetails[] };

/** A plugin on one machine, with the version it runs now and the version it will run after a restart */
export type MachinePlugin = Machine & {
	plugin?: lib.PluginDetails,
	running?: string,
	afterRestart?: string,
	disabled: boolean,
	/** Installed but never loaded on this machine as it has no entrypoint for it */
	noEntrypoint: boolean,
	/** The group's npm package name is a dependency here for another plugin, such as an alias */
	dependencyTaken: boolean,
	/** Another package here provides the plugin by the same name, startup skips this one */
	nameTaken: boolean,
	/** A host from before installedVersion was reported, it can't install a specific version */
	oldHost: boolean,
};
export type PluginStatus = {
	key: string,
	title: string,
	/** Not present for plugins that aren't published to npm */
	npmPackage?: string,
	machines: MachinePlugin[],
	/** Machines that haven't reported their plugins, such as hosts on an older version */
	unknown: Machine[],
};

/** Plugins are matched across machines by npm package, falling back to the plugin name */
export function pluginStatusKey(plugin: { name: string, npmPackage?: string }) {
	return plugin.npmPackage ?? plugin.name;
}

export function compareVersions(a: string, b: string) {
	if (semver.valid(a) && semver.valid(b)) {
		return semver.compare(a, b);
	}
	return strcmp(a, b);
}

/** The plugin with the given key on one machine, names are the plugin names known for that key */
function machinePlugin(machine: MachinePlugins, key: string, names: Set<string>): MachinePlugin {
	const { plugins, ...rest } = machine;
	// A package removed and installed again is listed twice, the removed one may still be running
	const candidates = plugins.filter(candidate => pluginStatusKey(candidate) === key);
	const plugin = candidates.find(candidate => !candidate.removed) ?? candidates[0];
	const absent = !plugin || Boolean(plugin.removed);
	const dependencyTaken = absent && plugins.some(
		candidate => candidate.dependencyName === key && !candidate.removed
	);
	const nameTaken = Boolean(plugin?.nameTaken) || (absent || Boolean(plugin.pendingInstall)) && plugins.some(
		candidate => (
			pluginStatusKey(candidate) !== key && names.has(candidate.name)
			&& !candidate.removed && !candidate.pendingInstall && !candidate.nameTaken
		)
	);
	const noEntrypoint = Boolean(plugin?.noEntrypoint);
	const oldHost = !machine.isController && plugins.length > 0 && plugins.every(
		candidate => candidate.installedVersion === undefined && !candidate.removed
	);
	const entry: MachinePlugin = {
		...rest, plugin, disabled: false, noEntrypoint, dependencyTaken, nameTaken, oldHost,
	};
	// What runs now follows loaded, what runs after a restart follows enabled and what is on disk
	entry.running = candidates.find(candidate => candidate.loaded)?.version;
	if (nameTaken) {
		return entry;
	}
	if (plugin?.pendingInstall) {
		// Plugins load by default, so a new install runs after the next restart
		entry.afterRestart = plugin.installedVersion ?? plugin.version;
	} else if (plugin && !plugin.removed && !noEntrypoint) {
		if (plugin.enabled) {
			entry.afterRestart = plugin.installedVersion ?? plugin.version;
		} else {
			entry.disabled = true;
		}
	}
	return entry;
}

/** Group the plugin lists of every machine by plugin */
export function computePluginStatuses(
	machines: MachinePlugins[], unknown: Machine[] = [],
): Map<string, PluginStatus> {
	const titles = new Map<string, string>();
	// Plugin names known from startup, pending installs are listed by package name
	const pluginNames = new Map<string, Set<string>>();
	for (const machine of machines) {
		for (const plugin of machine.plugins) {
			const key = pluginStatusKey(plugin);
			if (!titles.has(key) || plugin.loaded) {
				titles.set(key, plugin.title);
			}
			if (!plugin.pendingInstall && !plugin.nameTaken) {
				pluginNames.set(key, (pluginNames.get(key) ?? new Set()).add(plugin.name));
			}
		}
	}

	const statuses = new Map<string, PluginStatus>();
	for (const [key, title] of titles) {
		const status: PluginStatus = { key, title, machines: [], unknown };
		for (const machine of machines) {
			const entry = machinePlugin(machine, key, pluginNames.get(key) ?? new Set());
			status.npmPackage ??= entry.plugin?.npmPackage;
			status.machines.push(entry);
		}
		statuses.set(key, status);
	}
	return statuses;
}

export type SkippedOperation = { kind: PackageOperation["kind"], target: InstallTarget, reason: string };
export type UpdatePlan = {
	operations: PackageOperation[],
	skipped: SkippedOperation[],
};

/**
 * Bring every connected machine up to the given version, installing where the plugin is missing.
 * Machines already on that version or a newer one are left alone.
 */
export function planUpdate(
	status: PluginStatus,
	version: string,
	access: RemoteAccess,
	account: Pick<UserAccount, "hasPermission">,
): UpdatePlan {
	const plan: UpdatePlan = { operations: [], skipped: [] };
	if (!status.npmPackage) {
		return plan;
	}
	const packageSpec = `${status.npmPackage}@${version}`;
	for (const machine of status.machines) {
		const { plugin } = machine;
		const target = { name: machine.name, address: machine.address };
		const installed = plugin && !plugin.removed;
		if (installed && compareVersions(plugin.installedVersion ?? plugin.version, version) >= 0) {
			continue;
		}
		const kind = !installed || plugin.pendingInstall ? "install" : "update";
		const skip = (reason: string, skipKind: PackageOperation["kind"] = kind) => {
			plan.skipped.push({ kind: skipKind, target, reason });
		};
		if (machine.offline) {
			skip("offline");
		} else if (machine.nameTaken) {
			skip("another package provides this plugin", "install");
		} else if (machine.dependencyTaken) {
			skip(`another package is installed as ${status.npmPackage}`, "install");
		} else if (installed && !plugin.npmPackage) {
			// An alias, private or local package, installing the group's npm package would replace it
			skip("not installed from npm");
		} else if (machine.oldHost) {
			skip("host too old to install a specific version");
		} else if (kind === "install") {
			if (!account.hasPermission("core.plugin.install")) {
				skip("no install permission");
			} else if (access.canInstall(machine.address)) {
				plan.operations.push({ kind, target, packageSpec });
			} else {
				skip("remote installs disabled");
			}
		} else if (!account.hasPermission("core.plugin.update")) {
			skip("no update permission");
		} else if (access.canUpdate(machine.address)) {
			plan.operations.push({ kind, target, packageSpec });
		} else {
			skip("remote updates disabled");
		}
	}
	if (plan.operations.length || plan.skipped.length) {
		for (const machine of status.unknown) {
			const target = { name: machine.name, address: machine.address };
			plan.skipped.push({ kind: "update", target, reason: "plugins not reported" });
		}
	}
	return plan;
}

/** Plan for the given machine only */
export function planMachineUpdate(
	status: PluginStatus,
	machine: MachinePlugin,
	version: string,
	access: RemoteAccess,
	account: Pick<UserAccount, "hasPermission">,
): UpdatePlan {
	return planUpdate({ ...status, machines: [machine], unknown: [] }, version, access, account);
}

/** Short descriptions of the state of a plugin on a machine, beyond the versions it runs */
export function machineStatusLabels(machine: MachinePlugin) {
	const labels: string[] = [];
	if (machine.offline) {
		labels.push("Offline");
	}
	if (machine.nameTaken) {
		labels.push("Another package provides this plugin");
	} else if (!machine.plugin || machine.plugin.removed) {
		labels.push(machine.dependencyTaken ? "Another package is installed by this name" : "Not installed");
	} else {
		if (!machine.plugin.npmPackage) {
			labels.push("Not installed from npm");
		}
		if (machine.noEntrypoint) {
			labels.push("No entrypoint for this machine");
		}
		if (machine.disabled) {
			labels.push("Disabled");
		}
	}
	if (machine.running !== machine.afterRestart) {
		labels.push("Restart pending");
	}
	return labels;
}
