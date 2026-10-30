import React, { useContext, useState, useEffect } from "react";
import { Badge, Button, Flex, Input, Modal, Space, Switch, Table, Tooltip, Typography } from "antd";
import { ExclamationCircleOutlined, CopyOutlined, PlusOutlined } from "@ant-design/icons";

import * as lib from "@clusterio/lib";

import webUiPackage from "../../package.json";
import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import HostStatusTag from "./HostStatusTag";
import {
	MetricCpuRatio, MetricCpuUsed, MetricMemoryRatio, MetricMemoryUsed,
	MetricDiskUsed, MetricDiskRatio,
	RestartRequired,
} from "./system_metrics";
import { useHostPairings, useHosts } from "../model/host";
import { useSystems } from "../model/system";
import notify, { notifyErrorHandler } from "../util/notify";
import { formatDuration } from "../util/time_format";
import useTableQueryState from "../util/useTableQueryState";
import useColumnSearch from "../util/useColumnSearch";
import useRowNavigation from "../util/useRowNavigation";
import Link from "./Link";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;


/** Current time in milliseconds, updated every second while active */
function useNow(active: boolean) {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!active) {
			return undefined;
		}
		setNow(Date.now());
		const interval = setInterval(() => { setNow(Date.now()); }, 1000);
		return () => { clearInterval(interval); };
	}, [active]);
	return now;
}

function AddHostModal(props: { open: boolean, onClose: () => void }) {
	const control = useContext(ControlContext);
	const [requests, synced] = useHostPairings();
	const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
	const [busyCodes, setBusyCodes] = useState<ReadonlySet<string>>(new Set());
	const now = useNow(props.open);

	const controllerUrl = new URL(webRoot, document.location.href).href;
	const installCommand = `npm init "@clusterio" -- --mode host --controller-url ${controllerUrl}`;

	function setName(code: string, name?: string) {
		setNames(current => {
			const next = new Map(current);
			if (name === undefined) {
				next.delete(code);
			} else {
				next.set(code, name);
			}
			return next;
		});
	}

	function setBusy(code: string, busy: boolean) {
		setBusyCodes(current => {
			const next = new Set(current);
			if (busy) {
				next.add(code);
			} else {
				next.delete(code);
			}
			return next;
		});
	}

	function nameOf(request: Readonly<lib.HostPairingDetails>) {
		return (names.get(request.code) ?? request.name).trim();
	}

	function approve(request: Readonly<lib.HostPairingDetails>) {
		const name = nameOf(request);
		setBusy(request.code, true);
		control.send(
			new lib.HostPairingApproveRequest(request.code, name !== request.name ? name : undefined)
		).then(() => {
			setName(request.code);
			notify(`Approved host ${name}`, "success");
		}).catch(
			notifyErrorHandler(`Error approving host ${request.name}`)
		).finally(() => {
			setBusy(request.code, false);
		});
	}

	function reject(request: Readonly<lib.HostPairingDetails>) {
		setBusy(request.code, true);
		control.send(
			new lib.HostPairingRejectRequest(request.code)
		).then(() => {
			setName(request.code);
		}).catch(
			notifyErrorHandler(`Error rejecting host ${request.name}`)
		).finally(() => {
			setBusy(request.code, false);
		});
	}

	return <Modal
		title="Add Host"
		open={props.open}
		footer={null}
		onCancel={props.onClose}
		width="800px"
	>
		<Typography.Paragraph>
			Run the installer in an empty directory on the machine the host will run on.
			It asks for a name for the host, then shows a code and waits for the request to be approved here.
		</Typography.Paragraph>
		<div className="codeblock">
			<CopyButton
				message="Copied host setup commands to clipboard"
				text={["mkdir clusterio", "cd clusterio", installCommand].join("\n")}
			/>
			<p>&gt; mkdir clusterio</p>
			<p>&gt; cd clusterio</p>
			<p>
				&gt; npm init "@clusterio" -- --mode host
				--controller-url <span className="highlight">{controllerUrl}</span>
			</p>
		</div>
		<Typography.Paragraph>
			Once approved the installer saves the connection details of the host and exits.
			The host can then be started with the run-host script in that directory.
		</Typography.Paragraph>
		<Typography.Title level={5}>Waiting for approval</Typography.Title>
		<Typography.Paragraph type="secondary">
			Only approve a request if its code matches the code shown by the installer.
			An approved host has full access to the cluster.
		</Typography.Paragraph>
		<Table
			size="small"
			pagination={false}
			loading={!synced}
			rowKey="code"
			dataSource={[...requests.values()].sort((a, b) => a.createdAtMs - b.createdAtMs)}
			locale={{ emptyText: "No hosts are waiting for approval" }}
			columns={[
				{
					title: "Name",
					key: "name",
					render: (_, request) => <Input
						size="small"
						aria-label={`Name for host with code ${request.code}`}
						value={names.get(request.code) ?? request.name}
						onChange={event => { setName(request.code, event.target.value); }}
					/>,
				},
				{
					title: "Code",
					dataIndex: "code",
					render: (_, request) => <Typography.Text code strong>{request.code}</Typography.Text>,
				},
				{
					title: "Address",
					dataIndex: "remoteAddress",
				},
				{
					title: "Age",
					key: "age",
					render: (_, request) => <Tooltip title={new Date(request.createdAtMs).toLocaleString()}>
						<span>{formatDuration(Math.max(0, now - request.createdAtMs))}</span>
					</Tooltip>,
				},
				{
					key: "action",
					align: "right",
					render: (_, request) => {
						const busy = busyCodes.has(request.code);
						return <Space>
							<Button
								type="primary"
								size="small"
								disabled={busy || !nameOf(request)}
								onClick={() => { approve(request); }}
							>Approve</Button>
							<Button
								danger
								size="small"
								disabled={busy}
								onClick={() => { reject(request); }}
							>Reject</Button>
						</Space>;
					},
				},
			]}
		/>
	</Modal>;
}

function AddHostButton() {
	const [open, setOpen] = useState(false);
	const [requests] = useHostPairings();
	return <>
		<Badge count={requests.size} title={`${requests.size} waiting for approval`}>
			<Button type="primary" icon={<PlusOutlined />} onClick={() => { setOpen(true); }}>Add host</Button>
		</Badge>
		<AddHostModal open={open} onClose={() => { setOpen(false); }} />
	</>;
}

function CopyButton({ text, message }: { text: string, message: string }) {
	let [clipboardPermision, setClipboardPermission] = useState<PermissionState>("granted");
	useEffect(() => {
		(async () => {
			// @ts-expect-error missing API https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write
			let result = await navigator.permissions.query({ name: "clipboard-write" });
			setClipboardPermission(result.state);
			result.onchange = function () {
				setClipboardPermission(result.state);
			};
		})();
	}, []);

	async function checkClipboardPermission() {
		try {
			// @ts-expect-error missing API https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write
			let result = await navigator.permissions.query({ name: "clipboard-write" });
			setClipboardPermission(result.state);
			result.onchange = function () {
				setClipboardPermission(result.state);
			};
			return result.state === "granted";

		} catch (err: any) {
			// If it fail because "clipboard-write" is not supported.
			return err.name === "TypeError";
		}
	}

	return <Button
		className="copy-button"
		danger={clipboardPermision !== "granted"}
		onClick={async () => {
			if (await checkClipboardPermission()) {
				navigator.clipboard.writeText(text);
				notify(message);
			}
		}}
	>
		<CopyOutlined />
	</Button>;
}

export default function HostsPage() {
	let account = useAccount();
	let [hosts] = useHosts();
	const [systems] = useSystems();
	const [showRatios, setShowRatios] = useState(true);
	const [showNumbers, setShowNumbers] = useState(false);
	const [showCpuModel, setShowCpuModel] = useState(false);
	const tableState = useTableQueryState<lib.HostDetails>({
		namespace: "host", defaultSortKey: "name",
	});
	const nameSearch = useColumnSearch<lib.HostDetails>(tableState, "name", host => host.name, "Search hosts");
	const rowNav = useRowNavigation();

	return <PageLayout nav={[{ name: "Hosts" }]}>
		<PageHeader
			title="Hosts"
			extra={account.hasPermission("core.host.approve") ? <AddHostButton /> : undefined}
		/>
		<Table
			style={{ overflowX: "auto" }}
			columns={[
				{
					title: "Name",
					dataIndex: "name",
					sorter: (a, b) => strcmp(a.name, b.name),
					sortOrder: tableState.sortOrder("name"),
					filteredValue: tableState.filteredValue("name"),
					className: "table-link-cell",
					render: (_, host) => <Link to={`/hosts/${host.id}/view`} style={{ color: "inherit" }}>
						{host.name}
					</Link>,
					...nameSearch,
				},
				{
					title: "CPU Model",
					dataIndex: "cpuModel",
					sorter: (a, b) => strcmp(systems.get(a.id)?.cpuModel ?? "", systems.get(b.id)?.cpuModel ?? ""),
					sortOrder: tableState.sortOrder("cpuModel"),
					render: (_, host) => systems.get(host.id)?.cpuModel,
					hidden: !showCpuModel,
				},
				{
					title: "CPU%",
					key: "cpuPct",
					sorter: (a, b) => (systems.get(a.id)?.cpuRatio ?? 0) - (systems.get(b.id)?.cpuRatio ?? 0),
					sortOrder: tableState.sortOrder("cpuPct"),
					render: (_, host) => <MetricCpuRatio system={systems.get(host.id)} />,
					hidden: !showRatios,
				},
				{
					title: "Cores",
					key: "cores",
					sorter: (a, b) => (
						(systems.get(a.id)?.cpuUsed ?? 0) - (systems.get(b.id)?.cpuUsed ?? 0)
					),
					sortOrder: tableState.sortOrder("cores"),
					render: (_, host) => <MetricCpuUsed system={systems.get(host.id)} />,
					hidden: !showNumbers,
				},
				{
					title: "Mem%",
					key: "memPct",
					sorter: (a, b) => (
						(systems.get(a.id)?.memoryRatio ?? 0) - (systems.get(b.id)?.memoryRatio ?? 0)
					),
					sortOrder: tableState.sortOrder("memPct"),
					render: (_, host) => <MetricMemoryRatio system={systems.get(host.id)} />,
					hidden: !showRatios,
				},
				{
					title: "Memory",
					key: "memory",
					sorter: (a, b) => (
						(systems.get(a.id)?.memoryUsed ?? 0) - (systems.get(b.id)?.memoryUsed ?? 0)
					),
					sortOrder: tableState.sortOrder("memory"),
					render: (_, host) => <MetricMemoryUsed system={systems.get(host.id)} />,
					hidden: !showNumbers,
				},
				{
					title: "Disk%",
					key: "diskPct",
					sorter: (a, b) => (systems.get(a.id)?.diskAvailable ?? 0) - (systems.get(b.id)?.diskAvailable ?? 0),
					sortOrder: tableState.sortOrder("diskPct"),
					render: (_, host) => <MetricDiskRatio system={systems.get(host.id)} />,
					hidden: !showRatios,
				},
				{
					title: "Disk",
					key: "disk",
					sorter: (a, b) => (
						(systems.get(a.id)?.diskUsed ?? 0) - (systems.get(b.id)?.diskUsed ?? 0)
					),
					sortOrder: tableState.sortOrder("disk"),
					render: (_, host) => <MetricDiskUsed system={systems.get(host.id)} />,
					hidden: !showNumbers,
				},
				{
					title: "Version",
					dataIndex: "version",
					render: (_, host) => <Space>
						{host.version}
						{webUiPackage.version === host.version ? undefined : <Tooltip title="Version Mismatch">
							<ExclamationCircleOutlined style={{ color: "yellow" }}/>
						</Tooltip>}
					</Space>,
					sorter: (a, b) => strcmp(a.version, b.version),
					sortOrder: tableState.sortOrder("version"),
				},
				{
					title: "Public address",
					dataIndex: "publicAddress",
					sorter: (a, b) => strcmp(a.publicAddress??"", b.publicAddress??""),
					sortOrder: tableState.sortOrder("publicAddress"),
				},
				{
					title: "Connected",
					key: "connected",
					render: (_, host) => <>
						<HostStatusTag connected={host["connected"]}/>
						<RestartRequired system={systems.get(host.id)}/>
					</>,
					sorter: (a, b) => Number(a.connected) - Number(b.connected),
					sortOrder: tableState.sortOrder("connected"),
				},
			]}
			dataSource={[...hosts.values()]}
			rowKey={host => host.id}
			pagination={tableState.pagination}
			onChange={tableState.onChange}
			onRow={record => rowNav(`/hosts/${record.id}/view`)}
		/>
		<Flex wrap="wrap" style={{ margin: "16px 0 0 0" }} gap="small">
			<label style={{ width: "14em", display: "flex", justifyContent: "space-between", marginRight: 16 }}>
				Show metric ratios:
				<Switch checked={showRatios} onChange={checked => { setShowRatios(checked); }} />
			</label>
			<label style={{ width: "14em", display: "flex", justifyContent: "space-between", marginRight: 16 }}>
				Show metric numbers:
				<Switch checked={showNumbers} onChange={checked => { setShowNumbers(checked); }} />
			</label>
			<label style={{ width: "14em", display: "flex", justifyContent: "space-between", marginRight: 16 }}>
				Show CPU model:
				<Switch checked={showCpuModel} onChange={checked => { setShowCpuModel(checked); }} />
			</label>
		</Flex>
		<PluginExtra component="HostsPage" />
	</PageLayout>;
};
