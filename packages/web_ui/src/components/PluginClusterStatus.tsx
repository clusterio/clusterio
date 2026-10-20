import { useContext, useEffect, useState } from "react";
import { Button, Popconfirm, Tag, Tooltip, Typography } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useHosts } from "../model/host";
import { useInstances } from "../model/instance";
import { useSystems } from "../model/system";
import notify, { notifyErrorHandler } from "../util/notify";
import ControlContext from "./ControlContext";
import { PackageOperation, PluginInstaller, addressKey } from "./PluginInstall";
import {
	Machine, MachinePlugin, MachinePlugins, PluginStatus, UpdatePlan, compareVersions, planUpdate,
} from "../util/plugin_status";

const { Text } = Typography;
const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;
const refreshIntervalMs = 10e3;
const latestVersionsRefreshMs = 60e3;

function names(machines: Machine[]) {
	return machines.map(machine => machine.name).join(", ");
}

type MachinePluginsState = { machines?: MachinePlugins[], unreachable: Machine[], refresh: () => void };

/** Plugin lists of the controller and every connected host, refreshed periodically */
export function useMachinePlugins(): MachinePluginsState {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [hosts] = useHosts();
	const [machines, setMachines] = useState<MachinePlugins[]>();
	const [unreachable, setUnreachable] = useState<Machine[]>([]);
	const [refreshCount, setRefreshCount] = useState(0);
	const canList = account.hasPermission("core.plugin.list");
	const connectedHosts = [...hosts.values()]
		.filter(host => host.connected)
		.sort((a, b) => strcmp(a.name, b.name));
	const hostsKey = connectedHosts.map(host => `${host.id}:${host.name}`).join(",");

	useEffect(() => {
		if (!canList) {
			setMachines(undefined);
			setUnreachable([]);
			return undefined;
		}
		let canceled = false;
		// Refreshes can overlap when machines are slow to answer, only the newest one is shown
		let latestRefresh = 0;
		async function refresh() {
			latestRefresh += 1;
			const thisRefresh = latestRefresh;
			const targets: Machine[] = [
				{ name: "Controller", isController: true, address: "controller" },
				...connectedHosts.map(host => ({ name: host.name, isController: false, address: { hostId: host.id } })),
			];
			const results = await Promise.all(targets.map(async machine => {
				try {
					return { ...machine, plugins: await control.sendTo(machine.address, new lib.PluginListRequest()) };
				} catch (err) {
					return { ...machine, plugins: undefined };
				}
			}));
			if (!canceled && thisRefresh === latestRefresh) {
				setMachines(results.flatMap(result => (result.plugins ? [result as MachinePlugins] : [])));
				setUnreachable(results.flatMap(({ plugins, ...machine }) => (plugins ? [] : [machine])));
			}
		}
		refresh();
		const interval = setInterval(refresh, refreshIntervalMs);
		return () => { canceled = true; clearInterval(interval); };
	}, [hostsKey, refreshCount, canList]);

	return { machines, unreachable, refresh: () => setRefreshCount(count => count + 1) };
}

/** Latest version published on npm of each package */
export function useLatestVersions(packages: string[]) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [versions, setVersions] = useState<Record<string, string>>({});
	const packagesKey = [...new Set(packages)].sort().join(",");
	const canList = account.hasPermission("core.plugin.list");

	useEffect(() => {
		if (!packagesKey || !canList) {
			return undefined;
		}
		let canceled = false;
		let notified = false;
		function lookUp() {
			control.send(new lib.PluginLatestVersionsRequest(packagesKey.split(",")))
				.then(response => {
					if (!canceled) {
						// Merged so a lookup failing on a later refresh doesn't hide what was found before
						setVersions(current => ({ ...current, ...response.versions }));
					}
				})
				.catch(err => {
					if (!canceled && !notified) {
						notified = true;
						notifyErrorHandler("Failed to look up latest plugin versions")(err);
					}
				});
		}
		lookUp();
		// Packages the registry couldn't be reached for are left out, so look them up again later.
		// The controller caches the ones it found.
		const interval = setInterval(lookUp, latestVersionsRefreshMs);
		return () => { canceled = true; clearInterval(interval); };
	}, [packagesKey, canList]);

	return versions;
}

function isPending(machine: MachinePlugin) {
	return machine.running !== machine.afterRestart;
}

type CountLineProps = { label: string, machines: Machine[], total: number, type?: "warning" | "secondary" };
function CountLine(props: CountLineProps) {
	return <div>
		<Tooltip title={names(props.machines)}>
			<Text type={props.type}>{props.label} {props.machines.length}/{props.total}</Text>
		</Tooltip>
	</div>;
}

/** One line per version running now or after a restart, plus restart pending, disabled and missing counts */
export function PluginVersions(props: { status: PluginStatus, latest?: string }) {
	const { machines } = props.status;
	const total = machines.length;
	const versions = [...new Set(machines.flatMap(machine => [machine.running, machine.afterRestart]))]
		.filter((version): version is string => version !== undefined)
		.sort(compareVersions)
		.reverse();
	const pending = machines.filter(isPending);
	const disabled = machines.filter(machine => machine.disabled);
	const noEntrypoint = machines.filter(machine => machine.noEntrypoint);
	const missing = machines.filter(machine => !machine.plugin || machine.plugin.removed);
	const { unreachable } = props.status;

	return <>
		{versions.map(version => {
			const now = machines.filter(machine => machine.running === version);
			const after = machines.filter(machine => machine.afterRestart === version);
			const changes = names(now) !== names(after);
			return <div key={version}>
				<Tooltip title={<>
					<div>Running: {names(now) || "none"}</div>
					{changes && <div>After restart: {names(after) || "none"}</div>}
				</>}>
					<Text>{version}</Text>
					{props.latest === version && <Tag color="success" style={{ marginLeft: 6 }}>latest</Tag>}
					<Text type="secondary"> {now.length}/{total} running</Text>
					{changes && <Text type="secondary"> → {after.length}/{total} after restart</Text>}
				</Tooltip>
			</div>;
		})}
		{pending.length > 0 && <CountLine label="Restart pending on" machines={pending} total={total} />}
		{disabled.length > 0 && <CountLine label="Disabled on" machines={disabled} total={total} type="secondary" />}
		{noEntrypoint.length > 0 && <CountLine
			label="No entrypoint on" machines={noEntrypoint} total={total} type="secondary"
		/>}
		{missing.length > 0 && <CountLine label="Not installed on" machines={missing} total={total} type="warning" />}
		{unreachable.length > 0 && <div>
			<Tooltip title={names(unreachable)}>
				<Text type="warning">Couldn't list plugins on {unreachable.length}</Text>
			</Tooltip>
		</div>}
	</>;
}

type Account = ReturnType<typeof useAccount>;

function PlanDescription(props: UpdatePlan) {
	const byKind = (kind: PackageOperation["kind"]) => props.operations.filter(operation => operation.kind === kind);
	const targets = (operations: PackageOperation[]) => operations.map(operation => operation.target.name).join(", ");
	return <div style={{ maxWidth: 400 }}>
		{byKind("update").length > 0 && <div>Updates on {targets(byKind("update"))}.</div>}
		{byKind("install").length > 0 && <div>Installs on {targets(byKind("install"))}.</div>}
		{props.skipped.length > 0 && <div><Text type="secondary">
			Skipped {props.skipped.map(skip => skip.text).join(", ")}.
		</Text></div>}
	</div>;
}

function canChangePlugins(account: Account) {
	return account.hasPermission("core.plugin.install") || account.hasPermission("core.plugin.update");
}

type UpdateButtonProps = { status: PluginStatus, title?: string, latest?: string, installer: PluginInstaller };

/** Updates a plugin to the latest version on every connected machine */
export function PluginUpdateButton(props: UpdateButtonProps) {
	const account = useAccount();
	const { status, latest, installer } = props;
	if (!latest || !canChangePlugins(account)) {
		return null;
	}
	const plan = planUpdate(status, latest, installer.access, account);
	const changes = [...plan.operations, ...plan.skipped];
	if (!changes.length) {
		return null;
	}
	const onlyInstalls = changes.every(change => change.kind === "install");
	const label = onlyInstalls ? `Install on missing (${changes.length})` : `Update to ${latest}`;
	const title = `${onlyInstalls ? "Install" : "Update"} ${props.title ?? status.title} ${latest}`;
	if (!plan.operations.length) {
		return <Tooltip title={<PlanDescription {...plan} />}>
			<Button size="small" disabled>{label}</Button>
		</Tooltip>;
	}

	return <Popconfirm
		title={title}
		description={<>
			<PlanDescription {...plan} />
			{plan.operations.length > 0 && <div>Machines need a restart afterwards.</div>}
		</>}
		okText="Update"
		okButtonProps={{ disabled: !plan.operations.length }}
		onConfirm={() => installer.run(plan.operations)}
	>
		<Button size="small" loading={installer.installing}>{label}</Button>
	</Popconfirm>;
}

type UpdateAllProps = {
	statuses: PluginStatus[],
	/** Display names of plugins by status key, falling back to the title reported by the machines */
	titles?: Map<string, string>,
	latestVersions: Record<string, string>,
	installer: PluginInstaller,
};

/** Updates every plugin with a newer version to the latest version on every connected machine */
export function UpdateAllButton(props: UpdateAllProps) {
	const account = useAccount();
	if (!canChangePlugins(account)) {
		return null;
	}
	const plans = props.statuses.flatMap(status => {
		const latest = status.npmPackage && props.latestVersions[status.npmPackage];
		if (!latest) {
			return [];
		}
		const plan = planUpdate(status, latest, props.installer.access, account);
		return plan.operations.length ? [{ status, latest, plan }] : [];
	});
	if (!plans.length) {
		return null;
	}
	const operations = plans.flatMap(({ plan }) => plan.operations);
	const titleOf = (status: PluginStatus) => props.titles?.get(status.key) ?? status.title;

	return <Popconfirm
		title={`Update ${plans.length} plugin${plans.length > 1 ? "s" : ""} to the latest version`}
		description={<div style={{ maxWidth: 420 }}>
			{plans.map(({ status, latest, plan }) => <div key={status.key} style={{ marginBottom: 4 }}>
				<Text strong>{titleOf(status)} {latest}</Text>
				<PlanDescription {...plan} />
			</div>)}
			{operations.length > 0 && <div>Machines need a restart afterwards.</div>}
		</div>}
		okText="Update all"
		onConfirm={() => props.installer.run(operations)}
	>
		<Button loading={props.installer.installing}>Update all ({plans.length})</Button>
	</Popconfirm>;
}

type RestartPendingProps = {
	statuses: PluginStatus[],
	machines: MachinePlugins[],
	/** Plugin changes are running, a restart would make the remaining ones fail */
	busy?: boolean,
};

/** Restarts every connected machine with a pending restart, hosts first and the controller last */
export function RestartPendingButton(props: RestartPendingProps) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [systems] = useSystems();
	const [instances] = useInstances();
	const [restarting, setRestarting] = useState(false);

	const pendingKeys = new Set(props.statuses.flatMap(
		status => status.machines.filter(isPending).map(machine => addressKey(machine.address))
	));
	const systemOf = (machine: Machine) => systems.get(
		machine.address === "controller" ? "controller" : (machine.address as { hostId: number }).hostId
	);
	const pending = props.machines.filter(
		machine => pendingKeys.has(addressKey(machine.address)) || systemOf(machine)?.restartRequired
	);
	if (!pending.length) {
		return null;
	}

	const permitted = (machine: Machine) => account.hasPermission(
		machine.isController ? "core.controller.restart" : "core.host.restart"
	);
	const restartable = pending.filter(machine => systemOf(machine)?.canRestart && permitted(machine));
	const skipped = pending.filter(machine => !restartable.includes(machine));
	const runningInstances = (machine: Machine) => [...instances.values()].filter(instance => (
		!machine.isController
		&& instance.assignedHost === (machine.address as { hostId: number }).hostId
		&& !["unknown", "unassigned", "stopped", "deleted"].includes(instance.status)
	)).length;

	async function restart() {
		setRestarting(true);
		try {
			const hosts = restartable.filter(machine => !machine.isController);
			const results = await Promise.allSettled(hosts.map(
				machine => control.sendTo(machine.address, new lib.HostRestartRequest())
			));
			const started: Machine[] = [];
			results.forEach((result, i) => {
				if (result.status === "rejected") {
					notifyErrorHandler(`Failed to restart ${hosts[i].name}`)(result.reason);
				} else {
					started.push(hosts[i]);
				}
			});
			// The controller goes last as restarting it disconnects this page until it's back
			const controller = restartable.find(machine => machine.isController);
			if (controller) {
				try {
					await control.send(new lib.ControllerRestartRequest());
					started.push(controller);
				} catch (err: any) {
					notifyErrorHandler("Failed to restart the controller")(err);
				}
			}
			if (started.length) {
				notify(`Restarting ${names(started)}`, "info");
			}
		} finally {
			setRestarting(false);
		}
	}

	return <Popconfirm
		title={`Restart ${restartable.length} machine${restartable.length === 1 ? "" : "s"} with a pending restart`}
		description={<div style={{ maxWidth: 400 }}>
			{restartable.map(machine => {
				const count = runningInstances(machine);
				return <div key={addressKey(machine.address)}>
					{machine.name}
					{count > 0 && <Text type="warning">
						{" "}({count} running instance{count === 1 ? "" : "s"} will be stopped)
					</Text>}
				</div>;
			})}
			{skipped.length > 0 && <div><Text type="secondary">
				Skipped {names(skipped)}, these can only be restarted when running under a process monitor
				and with restart permission.
			</Text></div>}
		</div>}
		okText="Restart"
		okButtonProps={{ danger: true, disabled: !restartable.length }}
		onConfirm={restart}
	>
		<Button loading={restarting} disabled={props.busy}>Restart pending ({pending.length})</Button>
	</Popconfirm>;
}

/** Compact summary for search results: how many connected machines have the plugin installed */
export function PluginInstalledTag(props: { status: PluginStatus, latest?: string }) {
	const { machines } = props.status;
	const installed = machines.filter(machine => machine.plugin && !machine.plugin.removed);
	const current = machines.filter(machine => machine.afterRestart === props.latest);
	const color = current.length === machines.length ? "success" : "warning";
	return <Tooltip title={<PluginVersions status={props.status} latest={props.latest} />}>
		<Tag color={color}>Installed {installed.length}/{machines.length}</Tag>
	</Tooltip>;
}
