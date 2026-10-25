import { ReactNode, useContext, useEffect, useState } from "react";
import { Button, Checkbox, Modal, Popconfirm, Space, Table, Tag, Tooltip, Typography } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useHosts } from "../model/host";
import { useInstances } from "../model/instance";
import { useSystems } from "../model/system";
import notify, { notifyErrorHandler } from "../util/notify";
import { poll } from "../util/poll";
import ControlContext from "./ControlContext";
import Link from "./Link";
import { PackageOperation, PluginInstaller, addressKey } from "./PluginInstall";
import {
	Machine, MachinePlugin, MachinePlugins, PluginStatus, SkippedOperation, UpdatePlan,
	compareVersions, machineStatusLabels, planMachineUpdate, planUpdate,
} from "../util/plugin_status";

const { Text } = Typography;
const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;
const latestVersionsRefreshMs = 60e3;

function plural(count: number, word: string) {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function machinePath(machine: Machine) {
	return machine.isController ? "/controller" : `/hosts/${(machine.address as { hostId: number }).hostId}/view`;
}

type ListedPlugins = { plugins: lib.PluginDetails[], systemUpdatedAtMs?: number };
type MachinePluginsState = {
	machines?: MachinePlugins[],
	unknown: Machine[],
	/** Fetch the plugin lists of connected machines now, instead of waiting for the next system metrics */
	refresh: (addresses?: lib.AddressShorthand[]) => Promise<void>,
};

/**
 * Plugins of the controller and every host, as last collected with the system metrics. Offline
 * hosts keep the plugins they had when last seen.
 */
export function useMachinePlugins(): MachinePluginsState {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [hosts, hostsSynced] = useHosts();
	const [systems, systemsSynced] = useSystems();
	// Lists fetched directly, used until the system metrics of the machine update
	const [listed, setListed] = useState(new Map<string, ListedPlugins>());
	const canList = account.hasPermission("core.plugin.list");

	const allMachines: Machine[] = [
		{ name: "Controller", isController: true, address: "controller" },
		...[...hosts.values()]
			.filter(host => !host.isDeleted)
			.sort((a, b) => strcmp(a.name, b.name))
			.map(host => ({
				name: host.name, isController: false, address: { hostId: host.id }, offline: !host.connected,
			})),
	];
	const systemOf = (machine: Machine) => systems.get(
		machine.isController ? "controller" : (machine.address as { hostId: number }).hostId
	);

	async function refresh(addresses?: lib.AddressShorthand[]) {
		const keys = addresses && new Set(addresses.map(addressKey));
		const targets = allMachines.filter(
			machine => !machine.offline && (!keys || keys.has(addressKey(machine.address)))
		);
		const results = await Promise.all(targets.map(async machine => {
			try {
				const plugins = await control.sendTo(machine.address, new lib.PluginListRequest());
				const systemUpdatedAtMs = systemOf(machine)?.updatedAtMs;
				return [addressKey(machine.address), { plugins, systemUpdatedAtMs }] as const;
			} catch (err) {
				return undefined;
			}
		}));
		setListed(current => new Map([...current, ...results.filter(result => result !== undefined)]));
	}

	// Covers machines that don't report plugins in their metrics, and metrics being turned off
	const connectedKey = allMachines.filter(machine => !machine.offline).map(m => addressKey(m.address)).join(",");
	useEffect(() => {
		if (canList && hostsSynced) {
			refresh();
		}
	}, [canList, hostsSynced, connectedKey]);

	if (!canList || !hostsSynced || (!systemsSynced && !listed.size)) {
		return { machines: undefined, unknown: [], refresh };
	}
	const machines: MachinePlugins[] = [];
	const unknown: Machine[] = [];
	for (const machine of allMachines) {
		const system = systemOf(machine);
		const fresh = listed.get(addressKey(machine.address));
		const plugins = fresh && (!system?.plugins || fresh.systemUpdatedAtMs === system.updatedAtMs)
			? fresh.plugins
			: system?.plugins;
		if (plugins) {
			machines.push({ ...machine, plugins });
		} else {
			unknown.push(machine);
		}
	}
	return { machines, unknown, refresh };
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
		// Packages the registry couldn't be reached for are left out, so look them up again later.
		// The controller caches the ones it found.
		const stop = poll(async () => {
			try {
				const response = await control.send(new lib.PluginLatestVersionsRequest(packagesKey.split(",")));
				if (!canceled) {
					// Merged so a lookup failing on a later refresh doesn't hide what was found before
					setVersions(current => ({ ...current, ...response.versions }));
				}
			} catch (err: any) {
				if (!canceled && !notified) {
					notified = true;
					notifyErrorHandler("Failed to look up latest plugin versions")(err);
				}
			}
		}, latestVersionsRefreshMs);
		return () => { canceled = true; stop(); };
	}, [packagesKey, canList]);

	return versions;
}

function isPending(machine: MachinePlugin) {
	return machine.running !== machine.afterRestart;
}

function CountLine(props: { label: string, count: number, type?: "warning" | "secondary" }) {
	return <div><Text type={props.type}>{props.label} {props.count}</Text></div>;
}

/** One line per version running now or after a restart, plus restart pending, disabled and missing counts */
export function PluginVersions(props: { status: PluginStatus, latest?: string }) {
	const { machines, unknown } = props.status;
	const versions = [...new Set(machines.flatMap(machine => [machine.running, machine.afterRestart]))]
		.filter((version): version is string => version !== undefined)
		.sort(compareVersions)
		.reverse();
	const count = (filter: (machine: MachinePlugin) => boolean) => machines.filter(filter).length;
	const missing = count(machine => (!machine.plugin || Boolean(machine.plugin.removed)) && !machine.nameTaken);

	return <>
		{versions.map(version => {
			const now = count(machine => machine.running === version);
			const after = count(machine => machine.afterRestart === version);
			return <div key={version}>
				<Text>{version}</Text>
				{props.latest === version && <Tag color="success" style={{ marginLeft: 6 }}>latest</Tag>}
				<Text type="secondary" style={{ marginLeft: 12 }}>
					{plural(now, "machine")}{now !== after && ` → ${after} after restart`}
				</Text>
			</div>;
		})}
		{count(isPending) > 0 && <CountLine label="Restart pending on" count={count(isPending)} />}
		{count(machine => machine.disabled) > 0 && <CountLine
			label="Disabled on" count={count(machine => machine.disabled)} type="secondary"
		/>}
		{count(machine => machine.noEntrypoint) > 0 && <CountLine
			label="No entrypoint on" count={count(machine => machine.noEntrypoint)} type="secondary"
		/>}
		{count(machine => machine.nameTaken) > 0 && <CountLine
			label="From another package on" count={count(machine => machine.nameTaken)} type="secondary"
		/>}
		{missing > 0 && <CountLine label="Not installed on" count={missing} type="warning" />}
		{unknown.length > 0 && <CountLine label="Plugins not reported by" count={unknown.length} type="warning" />}
	</>;
}

type ChecklistItem = { key: string, label: ReactNode, disabledReason?: string };
type ChecklistModalProps = {
	open: boolean,
	title: string,
	okText: string,
	danger?: boolean,
	items: ChecklistItem[],
	extra?: ReactNode,
	onCancel: () => void,
	onOk: (keys: string[]) => void,
};

/** Confirms a list of actions, all ticked by default. Actions that can't be done are disabled with the reason. */
function ChecklistModal(props: ChecklistModalProps) {
	const [unchecked, setUnchecked] = useState(new Set<string>());
	useEffect(() => {
		if (props.open) {
			setUnchecked(new Set());
		}
	}, [props.open]);
	const possible = props.items.filter(item => !item.disabledReason);
	const selected = possible.filter(item => !unchecked.has(item.key));
	const toggle = (key: string, checked: boolean) => setUnchecked(current => {
		const next = new Set(current);
		if (checked) {
			next.delete(key);
		} else {
			next.add(key);
		}
		return next;
	});

	return <Modal
		title={props.title}
		open={props.open}
		okText={props.okText}
		okButtonProps={{ danger: props.danger, disabled: !selected.length }}
		onOk={() => props.onOk(selected.map(item => item.key))}
		onCancel={props.onCancel}
		destroyOnHidden
	>
		{props.extra}
		{possible.length > 1 && <Checkbox
			style={{ margin: "8px 0" }}
			checked={selected.length === possible.length}
			indeterminate={selected.length > 0 && selected.length < possible.length}
			onChange={event => setUnchecked(new Set(event.target.checked ? [] : possible.map(item => item.key)))}
		>All ({selected.length}/{possible.length})</Checkbox>}
		<div style={{ maxHeight: 320, overflowY: "auto" }}>
			{props.items.map(item => <div key={item.key}>
				<Checkbox
					checked={!item.disabledReason && !unchecked.has(item.key)}
					disabled={Boolean(item.disabledReason)}
					onChange={event => toggle(item.key, event.target.checked)}
				>
					{item.label}
					{item.disabledReason && <Text type="secondary"> ({item.disabledReason})</Text>}
				</Checkbox>
			</div>)}
		</div>
	</Modal>;
}

type Account = ReturnType<typeof useAccount>;

function canChangePlugins(account: Account) {
	return account.hasPermission("core.plugin.install") || account.hasPermission("core.plugin.update");
}

function operationKey(change: PackageOperation | SkippedOperation, title: string) {
	return `${title}:${change.kind}:${addressKey(change.target.address)}`;
}

type PlannedUpdate = { title: string, latest: string, plan: UpdatePlan };

/** One checklist item per operation and skipped operation */
function planItems(updates: PlannedUpdate[], withTitle: boolean) {
	const operations = new Map<string, PackageOperation>();
	const items: ChecklistItem[] = [];
	for (const { title, latest, plan } of updates) {
		const label = (change: PackageOperation | SkippedOperation) => <>
			{withTitle && <Text strong>{title}: </Text>}
			{change.kind === "install" ? "Install" : "Update to"} {latest} on {change.target.name}
		</>;
		for (const operation of plan.operations) {
			const key = operationKey(operation, title);
			operations.set(key, operation);
			items.push({ key, label: label(operation) });
		}
		for (const skipped of plan.skipped) {
			items.push({ key: operationKey(skipped, title), label: label(skipped), disabledReason: skipped.reason });
		}
	}
	return { items, operations };
}

type UpdateButtonProps = { status: PluginStatus, title?: string, latest?: string, installer: PluginInstaller };

/** Updates a plugin to the latest version on every machine */
export function PluginUpdateButton(props: UpdateButtonProps) {
	const account = useAccount();
	const [open, setOpen] = useState(false);
	const { status, latest, installer } = props;
	if (!latest || !canChangePlugins(account)) {
		return null;
	}
	const plan = planUpdate(status, latest, installer.access, account);
	const changes = [...plan.operations, ...plan.skipped];
	if (!changes.length) {
		return <Tooltip title="Up to date on every machine">
			<Button size="small" disabled>Update to {latest}</Button>
		</Tooltip>;
	}
	const onlyInstalls = changes.every(change => change.kind === "install");
	const label = onlyInstalls ? `Install on missing (${changes.length})` : `Update to ${latest}`;
	const title = props.title ?? status.title;
	const { items, operations } = planItems([{ title, latest, plan }], false);

	return <>
		<Button
			size="small"
			loading={installer.installing}
			disabled={installer.restarting}
			onClick={() => setOpen(true)}
		>{label}</Button>
		<ChecklistModal
			open={open}
			title={`${onlyInstalls ? "Install" : "Update"} ${title} ${latest}`}
			okText={onlyInstalls ? "Install" : "Update"}
			items={items}
			extra={<p>Machines need a restart afterwards.</p>}
			onCancel={() => setOpen(false)}
			onOk={keys => {
				setOpen(false);
				installer.run(keys.map(key => operations.get(key)!));
			}}
		/>
	</>;
}

type UpdateAllProps = {
	statuses: PluginStatus[],
	/** Display names of plugins by status key, falling back to the title reported by the machines */
	titles?: Map<string, string>,
	latestVersions: Record<string, string>,
	installer: PluginInstaller,
};

/** Updates every plugin with a newer version to the latest version on every machine */
export function UpdateAllButton(props: UpdateAllProps) {
	const account = useAccount();
	const [open, setOpen] = useState(false);
	if (!canChangePlugins(account)) {
		return null;
	}
	const updates = props.statuses.flatMap(status => {
		const latest = status.npmPackage && props.latestVersions[status.npmPackage];
		if (!latest) {
			return [];
		}
		const plan = planUpdate(status, latest, props.installer.access, account);
		const title = props.titles?.get(status.key) ?? status.title;
		return plan.operations.length || plan.skipped.length ? [{ title, latest, plan }] : [];
	});
	const pluginCount = updates.filter(update => update.plan.operations.length).length;
	const { items, operations } = planItems(updates, true);

	return <>
		<Tooltip title={pluginCount ? undefined : "No plugin updates can be done"}>
			<Button
				loading={props.installer.installing}
				disabled={!pluginCount || props.installer.restarting}
				onClick={() => setOpen(true)}
			>Update all ({pluginCount})</Button>
		</Tooltip>
		<ChecklistModal
			open={open}
			title={`Update ${plural(pluginCount, "plugin")} to the latest version`}
			okText="Update"
			items={items}
			extra={<p>Machines need a restart afterwards.</p>}
			onCancel={() => setOpen(false)}
			onOk={keys => {
				setOpen(false);
				props.installer.run(keys.map(key => operations.get(key)!));
			}}
		/>
	</>;
}

type RestartPendingProps = {
	statuses: PluginStatus[],
	machines: MachinePlugins[],
	installer: PluginInstaller,
};

/** Restarts the chosen machines with a pending restart, hosts first and the controller last */
export function RestartPendingButton(props: RestartPendingProps) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [systems] = useSystems();
	const [instances] = useInstances();
	const [open, setOpen] = useState(false);
	const { installer } = props;
	const permitted = (machine: Machine) => account.hasPermission(
		machine.isController ? "core.controller.restart" : "core.host.restart"
	);
	if (!account.hasPermission("core.controller.restart") && !account.hasPermission("core.host.restart")) {
		return null;
	}

	const pendingKeys = new Set(props.statuses.flatMap(
		status => status.machines.filter(isPending).map(machine => addressKey(machine.address))
	));
	const systemOf = (machine: Machine) => systems.get(
		machine.isController ? "controller" : (machine.address as { hostId: number }).hostId
	);
	const pending = props.machines.filter(
		machine => pendingKeys.has(addressKey(machine.address)) || systemOf(machine)?.restartRequired
	);
	const cannotRestart = (machine: Machine) => {
		if (machine.offline) {
			return "offline";
		}
		if (!permitted(machine)) {
			return "no restart permission";
		}
		if (!systemOf(machine)?.canRestart) {
			return "not running under a process monitor";
		}
		return undefined;
	};
	const runningInstances = (machine: Machine) => [...instances.values()].filter(instance => (
		!machine.isController
		&& instance.assignedHost === (machine.address as { hostId: number }).hostId
		&& !["unknown", "unassigned", "stopped", "deleted"].includes(instance.status)
	)).length;
	const items = pending.map(machine => {
		const count = runningInstances(machine);
		return {
			key: addressKey(machine.address),
			label: <>
				{machine.name}
				{count > 0 && <Text type="warning"> stops {plural(count, "running instance")}</Text>}
			</>,
			disabledReason: cannotRestart(machine),
		};
	});
	const blocked = items.filter(item => item.disabledReason).length;

	async function restartMachines(restart: MachinePlugins[]) {
		const hosts = restart.filter(machine => !machine.isController);
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
		const controller = restart.find(machine => machine.isController);
		if (controller) {
			try {
				await control.send(new lib.ControllerRestartRequest());
				started.push(controller);
			} catch (err: any) {
				notifyErrorHandler("Failed to restart the controller")(err);
			}
		}
		if (started.length) {
			notify(`Restarting ${plural(started.length, "machine")}`, "info");
		}
	}

	return <>
		<Tooltip title={pending.length
			? `${plural(pending.length, "machine")} need a restart`
			: "No machine needs a restart"
		}>
			<Button
				loading={installer.restarting}
				disabled={!pending.length || installer.installing}
				onClick={() => setOpen(true)}
			>Restart pending ({pending.length})</Button>
		</Tooltip>
		<ChecklistModal
			open={open}
			title="Restart machines with a pending restart"
			okText="Restart"
			danger
			items={items}
			extra={blocked > 0 && <p>
				{plural(blocked, "machine")} can't be restarted from here and must be restarted by hand.
				The <Link to="/hosts">hosts list</Link> will show which need to be restarted.
			</p>}
			onCancel={() => setOpen(false)}
			onOk={keys => {
				setOpen(false);
				const restart = pending.filter(machine => keys.includes(addressKey(machine.address)));
				installer.restart(() => restartMachines(restart));
			}}
		/>
	</>;
}

type MachineRow = MachinePlugin | (Machine & { unknown: true });

type MachineActionProps = { status: PluginStatus, machine: MachinePlugin, latest: string, installer: PluginInstaller };

/** Install or update action for one machine, disabled with the reason when it can't be done */
function MachineAction(props: MachineActionProps) {
	const account = useAccount();
	const { status, machine, latest, installer } = props;
	const plan = planMachineUpdate(status, machine, latest, installer.access, account);
	const [operation] = plan.operations;
	const [skipped] = plan.skipped;
	const change = operation ?? skipped;
	if (!change) {
		return null;
	}
	const label = `${change.kind === "install" ? "Install" : "Update to"} ${latest}`;
	if (!operation) {
		return <Tooltip title={skipped.reason}><Button size="small" disabled>{label}</Button></Tooltip>;
	}
	return <Popconfirm
		title={`${label} on ${machine.name}?`}
		description="The machine needs a restart afterwards."
		onConfirm={() => installer.run([operation])}
	>
		<Button size="small" loading={installer.installing} disabled={installer.restarting}>{label}</Button>
	</Popconfirm>;
}

/** Version and status of a plugin on each machine */
export function PluginMachinesTable(props: { status: PluginStatus, latest?: string, installer: PluginInstaller }) {
	const account = useAccount();
	const { status, latest, installer } = props;
	const rows: MachineRow[] = [
		...status.machines,
		...status.unknown.map(machine => ({ ...machine, unknown: true as const })),
	];
	return <Table
		size="small"
		dataSource={rows}
		rowKey={machine => addressKey(machine.address)}
		pagination={{ defaultPageSize: 20, hideOnSinglePage: true }}
		columns={[
			{
				title: "Machine",
				key: "name",
				render: (_, machine) => <Link to={machinePath(machine)}>{machine.name}</Link>,
				sorter: (a, b) => strcmp(a.name, b.name),
			},
			{
				title: "Running",
				key: "running",
				render: (_, machine) => ("unknown" in machine ? null : <>
					{machine.running ?? <Text type="secondary">None</Text>}
					{machine.running !== undefined && machine.running === latest
						&& <Tag color="success" style={{ marginLeft: 6 }}>latest</Tag>}
				</>),
			},
			{
				title: "After restart",
				key: "afterRestart",
				render: (_, machine) => ("unknown" in machine || !isPending(machine)
					? null
					: machine.afterRestart ?? <Text type="secondary">None</Text>),
			},
			{
				title: "Status",
				key: "status",
				render: (_, machine) => <Space size={[0, 4]} wrap>
					{("unknown" in machine ? ["Plugins not reported"] : machineStatusLabels(machine))
						.map(label => <Tag key={label}>{label}</Tag>)}
				</Space>,
			},
			{
				key: "action",
				align: "right",
				render: (_, machine) => (latest && !("unknown" in machine) && canChangePlugins(account)
					? <MachineAction status={status} machine={machine} latest={latest} installer={installer} />
					: null),
			},
		]}
	/>;
}

/** Compact summary for search results: how many machines have the plugin installed */
export function PluginInstalledTag(props: { status: PluginStatus, latest?: string }) {
	const { machines } = props.status;
	const installed = machines.filter(machine => machine.plugin && !machine.plugin.removed);
	const current = machines.filter(machine => machine.afterRestart === props.latest);
	const color = current.length === machines.length ? "success" : "warning";
	return <Tooltip title={<PluginVersions status={props.status} latest={props.latest} />}>
		<Tag color={color}>Installed on {installed.length}</Tag>
	</Tooltip>;
}
