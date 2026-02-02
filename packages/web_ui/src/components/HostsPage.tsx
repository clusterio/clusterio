import React, { useContext, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Flex, Form, InputNumber, Modal, Space, Switch, Table, Tooltip, Typography } from "antd";
import { ExclamationCircleOutlined, CopyOutlined } from "@ant-design/icons";

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
import { useHosts } from "../model/host";
import { useSystems } from "../model/system";
import notify, { notifyErrorHandler } from "../util/notify";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;


function GenerateHostTokenButton() {
	let control = useContext(ControlContext);
	let [open, setOpen] = useState(false);
	let [token, setToken] = useState<string|null>(null);
	let [hostId, setHostId] = useState<number|null>(null);
	let [form] = Form.useForm();
	let [pluginList, setPluginList] = useState<lib.PluginWebApi[]>([]);
	useEffect(() => {
		(async () => {
			let response = await fetch(`${webRoot}api/plugins`);
			if (response.ok) {
				const plugins = await response.json();
				setPluginList(plugins);
			} else {
				notify("Failed to load plugin list");
			}
		})();
	}, []);

	async function generateToken() {
		let id;
		let values = form.getFieldsValue();
		if (values.hostId) {
			id = Number.parseInt(values.hostId, 10);
			if (Number.isNaN(id)) {
				form.setFields([{ name: "hostId", errors: ["Must be an integer"] }]);
				return;
			}
			form.setFields([{ name: "hostId", errors: [] }]);
		}

		let newToken = await control.send(new lib.HostGenerateTokenRequest(id));
		setToken(newToken);
		setHostId(id??null);
	}

	// Generate a new random
	useEffect(() => {
		if (open) {
			generateToken().catch(notifyErrorHandler("Error generating token"));
		}
	}, [open]);

	const pluginString = pluginList.filter(p => p.npmPackage).map(p => `"${p.npmPackage}"`).join(" ");
	return <>
		<Button
			onClick={() => { setOpen(true); }}
		>Generate Token</Button>
		<Modal
			title="Generate Host Token"
			open={open}
			footer={null}
			onCancel={() => {
				setOpen(false);
				setToken(null);
				form.resetFields();
			}}
			width="700px"
		>
			<Form form={form} layout="vertical" requiredMark="optional">
				<Form.Item name="hostId" label="Host ID">
					<InputNumber onChange={() => {
						generateToken().catch(notifyErrorHandler("Error generating token"));
					}} />
				</Form.Item>
			</Form>
			{token !== null && <>
				<Typography.Paragraph>
					Host auth token:
				</Typography.Paragraph>
				<div className="codeblock">
					<CopyButton
						message={"Copied auth token to clipboard"}
						text={token}
					/>
					{token}
				</div>
				<Typography.Paragraph>
					You can set the token on an existing host with the following command:
				</Typography.Paragraph>
				<div className="codeblock">
					<CopyButton
						message={"Copied configuration commands to clipboard"}
						text={`npx clusteriohost config set host.controller_token ${token}
							   npx clusteriohost config set host.id ${hostId}`}
					/>
					<p>npx clusteriohost config set host.controller_token &lt;token&gt;</p>
					<p>npx clusteriohost config set host.id &lt;hostId&gt;</p>
				</div>
				<Typography.Paragraph>
					Example host setup commands:
				</Typography.Paragraph>
				<div className="codeblock">
					<CopyButton
						message={"Copied host setup commands to clipboard"}
						text={`\
mkdir clusterio
cd clusterio
npm init "@clusterio" -- --controller-token ${token} --mode "host" --download-headless \
--controller-url ${document.location.origin}/ --host-name "Host ${hostId || "?"}" \
--public-address localhost ${pluginString.length ? "--plugins" : ""} ${pluginString}`
						}/>
					<p>&gt; mkdir clusterio</p>
					<p>&gt; cd clusterio</p>
					<p>
						&gt; npm init "@clusterio" --
						--controller-token <span className="highlight">{token} </span>
						--mode "host"
						--download-headless
						--controller-url <span className="highlight">{document.location.origin}/ </span>
						--host-name <span className="highlight">"Host {hostId || "?"}" </span>
						--public-address <span className="highlight">localhost </span>
						{pluginString.length ? "--plugins" : ""} <span className="highlight">{pluginString}</span>
					</p>
					<p>&gt; ./run-host</p>
				</div>
			</>}
		</Modal>
	</>;
}

function CopyButton({ text, message }: { text:string, message:string }) {
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
	let navigate = useNavigate();
	let [hosts] = useHosts();
	const [systems] = useSystems();
	const [showRatios, setShowRatios] = useState(true);
	const [showNumbers, setShowNumbers] = useState(false);
	const [showCpuModel, setShowCpuModel] = useState(false);

	return <PageLayout nav={[{ name: "Hosts" }]}>
		<PageHeader
			title="Hosts"
			extra={account.hasPermission("core.host.generate_token") ? <GenerateHostTokenButton /> : undefined}
		/>
		<Table
			style={{ overflowX: "auto" }}
			columns={[
				{
					title: "Name",
					dataIndex: "name",
					defaultSortOrder: "ascend",
					sorter: (a, b) => strcmp(a.name, b.name),
				},
				{
					title: "CPU Model",
					dataIndex: "cpuModel",
					sorter: (a, b) => strcmp(systems.get(a.id)?.cpuModel ?? "", systems.get(b.id)?.cpuModel ?? ""),
					render: (_, host) => systems.get(host.id)?.cpuModel,
					hidden: !showCpuModel,
				},
				{
					title: "CPU%",
					key: "cpuPct",
					sorter: (a, b) => (systems.get(a.id)?.cpuRatio ?? 0) - (systems.get(b.id)?.cpuRatio ?? 0),
					render: (_, host) => <MetricCpuRatio system={systems.get(host.id)} />,
					hidden: !showRatios,
				},
				{
					title: "Cores",
					key: "cores",
					sorter: (a, b) => (
						(systems.get(a.id)?.cpuUsed ?? 0) - (systems.get(b.id)?.cpuUsed ?? 0)
					),
					render: (_, host) => <MetricCpuUsed system={systems.get(host.id)} />,
					hidden: !showNumbers,
				},
				{
					title: "Mem%",
					key: "memPct",
					sorter: (a, b) => (
						(systems.get(a.id)?.memoryRatio ?? 0) - (systems.get(b.id)?.memoryRatio ?? 0)
					),
					render: (_, host) => <MetricMemoryRatio system={systems.get(host.id)} />,
					hidden: !showRatios,
				},
				{
					title: "Memory",
					key: "memory",
					sorter: (a, b) => (
						(systems.get(a.id)?.memoryUsed ?? 0) - (systems.get(b.id)?.memoryUsed ?? 0)
					),
					render: (_, host) => <MetricMemoryUsed system={systems.get(host.id)} />,
					hidden: !showNumbers,
				},
				{
					title: "Disk%",
					key: "diskPct",
					sorter: (a, b) => (systems.get(a.id)?.diskAvailable ?? 0) - (systems.get(b.id)?.diskAvailable ?? 0),
					render: (_, host) => <MetricDiskRatio system={systems.get(host.id)} />,
					hidden: !showRatios,
				},
				{
					title: "Disk",
					key: "disk",
					sorter: (a, b) => (
						(systems.get(a.id)?.diskUsed ?? 0) - (systems.get(b.id)?.diskUsed ?? 0)
					),
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
				},
				{
					title: "Public address",
					dataIndex: "publicAddress",
					sorter: (a, b) => strcmp(a.publicAddress??"", b.publicAddress??""),
				},
				{
					title: "Connected",
					key: "connected",
					render: (_, host) => <>
						<HostStatusTag connected={host["connected"]}/>
						<RestartRequired system={systems.get(host.id)}/>
					</>,
					sorter: (a, b) => Number(a.connected) - Number(b.connected),
				},
			]}
			dataSource={[...hosts.values()]}
			rowKey={host => host.id}
			pagination={false}
			onRow={(record, rowIndex) => ({
				onClick: event => {
					navigate(`/hosts/${record.id}/view`);
				},
			})}
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
