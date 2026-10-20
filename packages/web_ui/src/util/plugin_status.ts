import semver from "semver";

import type * as lib from "@clusterio/lib";

import type { UserAccount } from "../BaseWebPlugin";
import type { PackageOperation, RemoteAccess } from "../components/PluginInstall";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

export type Machine = { name: string, isController: boolean, address: lib.AddressShorthand };
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
};
export type PluginStatus = {
	key: string,
	title: string,
	/** Not present for plugins that aren't published to npm */
	npmPackage?: string,
	machines: MachinePlugin[],
	/** Connected machines whose plugin list couldn't be fetched */
	unreachable: Machine[],
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

/** Group the plugin lists of every machine by plugin */
export function computePluginStatuses(
	machines: MachinePlugins[], unreachable: Machine[] = [],
): Map<string, PluginStatus> {
	const titles = new Map<string, string>();
	for (const machine of machines) {
		for (const plugin of machine.plugins) {
			const key = pluginStatusKey(plugin);
			if (!titles.has(key) || plugin.loaded) {
				titles.set(key, plugin.title);
			}
		}
	}

	const statuses = new Map<string, PluginStatus>();
	for (const [key, title] of titles) {
		const status: PluginStatus = { key, title, machines: [], unreachable };
		for (const machine of machines) {
			const { plugins, ...rest } = machine;
			const plugin = plugins.find(candidate => pluginStatusKey(candidate) === key);
			status.npmPackage ??= plugin?.npmPackage;
			const dependencyTaken = (!plugin || Boolean(plugin.removed)) && plugins.some(
				candidate => candidate.dependencyName === key && !candidate.removed
			);
			const noEntrypoint = Boolean(plugin?.noEntrypoint);
			const entry: MachinePlugin = { ...rest, plugin, disabled: false, noEntrypoint, dependencyTaken };
			// What runs now follows loaded, what runs after a restart follows enabled and what is on disk
			if (plugin?.loaded) {
				entry.running = plugin.version;
			}
			if (plugin?.pendingInstall) {
				// Plugins load by default, so a new install runs after the next restart
				entry.afterRestart = plugin.installedVersion ?? plugin.version;
			} else if (plugin && !plugin.enabled && !noEntrypoint) {
				entry.disabled = true;
			} else if (plugin && !plugin.removed && !noEntrypoint) {
				entry.afterRestart = plugin.installedVersion ?? plugin.version;
			}
			status.machines.push(entry);
		}
		statuses.set(key, status);
	}
	return statuses;
}

export type UpdatePlan = {
	operations: PackageOperation[],
	skipped: { kind: PackageOperation["kind"], text: string }[],
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
		if (machine.dependencyTaken) {
			const text = `${machine.name} (another package is installed as ${status.npmPackage})`;
			plan.skipped.push({ kind: "install", text });
		} else if (installed && !plugin.npmPackage) {
			// An alias, private or local package, installing the group's npm package would replace it
			const kind = plugin.pendingInstall ? "install" : "update";
			plan.skipped.push({ kind, text: `${machine.name} (not installed from npm)` });
		} else if (!installed || plugin.pendingInstall) {
			if (!account.hasPermission("core.plugin.install")) {
				plan.skipped.push({ kind: "install", text: `${machine.name} (no install permission)` });
			} else if (access.canInstall(machine.address)) {
				plan.operations.push({ kind: "install", target, packageSpec });
			} else {
				plan.skipped.push({ kind: "install", text: `${machine.name} (remote installs disabled)` });
			}
		} else if (!account.hasPermission("core.plugin.update")) {
			plan.skipped.push({ kind: "update", text: `${machine.name} (no update permission)` });
		} else if (access.canUpdate(machine.address)) {
			plan.operations.push({ kind: "update", target, packageSpec });
		} else {
			plan.skipped.push({ kind: "update", text: `${machine.name} (remote updates disabled)` });
		}
	}
	if (plan.operations.length || plan.skipped.length) {
		for (const machine of status.unreachable) {
			plan.skipped.push({ kind: "update", text: `${machine.name} (couldn't list plugins)` });
		}
	}
	return plan;
}
