import React, { useContext, useState } from "react";
import { Descriptions, Spin, Typography, Button, Space, Popconfirm, Flex, Tooltip } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useNavigate, useParams } from "react-router-dom";

import * as lib from "@clusterio/lib";
import notify, { notifyErrorHandler } from "../util/notify";
import ControlContext from "./ControlContext";
import HostConfigTree from "./HostConfigTree";
import HostStatusTag from "./HostStatusTag";
import InstanceList from "./InstanceList";
import LogConsole, { SelectMaxLogLevel } from "./LogConsole";
import { useAccount } from "../model/account";
import { useInstances } from "../model/instance";
import { useHost } from "../model/host";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import ResourceNotes from "./ResourceNotes";
import {
	MetricCpuRatio, MetricCpuUsed, MetricMemoryRatio, MetricMemoryUsed,
	MetricDiskUsed, MetricDiskRatio, MetricRelativeDate,
} from "./system_metrics";
import { useSystems } from "../model/system";
import { hasNpmButtonPermission, NpmButton } from "./NpmButton";
import VariableDropdownButton, { VariableDropdownButtonProps } from "./VariableDropdownButton";

const { Title } = Typography;

type HostControlButtonProps = { hostId: number, canRestart?: boolean, restartRequired?: boolean };

function HostControlButton({ hostId, canRestart, restartRequired }: HostControlButtonProps) {
	const account = useAccount();
	const control = useContext(ControlContext);
	const actions: VariableDropdownButtonProps["actions"] = [];

	if (account.hasPermission("core.host.restart") && canRestart) {
		actions.push({
			key: "restart",
			label: (
				!restartRequired ? "Restart" : <Tooltip title={"Restart Required"}><Space>
					<ExclamationCircleOutlined style={{ color: "yellow" }}/>
					Restart
				</Space></Tooltip>
			),
			onClick: () => {
				control.sendTo(
					{ hostId },
					new lib.HostRestartRequest()
				).catch(notifyErrorHandler("Error restarting host"));
			},
		});
	}

	if (account.hasPermission("core.host.restart") && !restartRequired) {
		actions.push({
			key: "mark-restart-required",
			label: "Mark Restart Required",
			onClick: () => {
				control.sendTo(
					{ hostId },
					new lib.HostMarkRestartRequiredRequest()
				).then(() => {
					notify("Host marked as requiring a restart", "success");
				}).catch(notifyErrorHandler("Error marking host"));
			},
		});
	}

	if (account.hasPermission("core.host.stop")) {
		actions.push({
			key: "stop",
			danger: true,
			label: (
				<Popconfirm
					title={<>
						Stopping this host will leave it inaccessible until someone with
						access to the system it runs on manually starts it again.<br />
						Are you sure you want to stop the host?
					</>}
					placement="bottomRight"
					okText="Stop"
					okButtonProps={{ danger: true }}
					onConfirm={() => {
						control.sendTo(
							{ hostId },
							new lib.HostStopRequest()
						).catch(notifyErrorHandler("Error stopping host"));
					}}
				>
					Stop
				</Popconfirm>
			),
		});
	}

	return <VariableDropdownButton actions={actions} />;
}

type RevokeHostButtonProps = { host: lib.HostDetails, instances: ReadonlyMap<number, lib.InstanceDetails> };

function RevokeHostButton({ host, instances }: RevokeHostButtonProps) {
	const control = useContext(ControlContext);
	const navigate = useNavigate();
	const assigned = [...instances.values()].map(instance => instance.name);

	return <Popconfirm
		title={`Revoke access for ${host.name}?`}
		description={<>
			The host is removed from the cluster and disconnected.<br />
			{assigned.length > 0 && <>Its instances become unassigned: {assigned.join(", ")}<br /></>}
			To add it back, start the host again and approve it.
		</>}
		placement="bottomRight"
		okText="Revoke"
		okButtonProps={{ danger: true }}
		onConfirm={() => control.send(
			new lib.HostRevokeRequest(host.id)
		).then(() => {
			notify(`Revoked access for host ${host.name}`, "success");
			navigate("/hosts");
		}).catch(notifyErrorHandler(`Error revoking access for host ${host.name}`))}
	>
		<Button danger>Revoke host access</Button>
	</Popconfirm>;
}

export default function HostViewPage() {
	let params = useParams();
	let hostId = Number(params.id);
	let account = useAccount();
	let [instances] = useInstances();
	const [systems] = useSystems();
	const system = systems.get(hostId);
	const [host, synced] = useHost(hostId);
	const [maxLevel, setMaxLevel] = useState<keyof typeof lib.levels>("info");
	const canShowNpm = hasNpmButtonPermission(false);
	const hostInstances = new Map([...instances].filter(([_id, instance]) => instance.assignedHost === hostId));

	let nav = [{ name: "Hosts", path: "/hosts" }, { name: host?.name ?? String(hostId) }];
	if (!host) {
		if (!synced) {
			return <PageLayout nav={nav}><Spin size="large" /></PageLayout>;
		}

		return <PageLayout nav={nav}>
			<PageHeader title={String(hostId)} />
			<p>Host with id {hostId} was not found on the controller.</p>
		</PageLayout>;
	}

	let hostButtons = <Space wrap>
		<HostControlButton hostId={hostId} canRestart={system?.canRestart} restartRequired={system?.restartRequired}/>
		{account.hasPermission("core.host.revoke") && <RevokeHostButton host={host} instances={hostInstances} />}
		{canShowNpm && (
			<NpmButton target={{ hostId }} canRestart={system?.canRestart} disabled={!host["connected"]}/>
		)}
	</Space>;

	return <PageLayout nav={nav}>
		<PageHeader
			title={host.name || String(hostId)}
			status={<HostStatusTag connected={host["connected"]}/>}
			extra={hostButtons}
		/>
		<Descriptions bordered size="small" column={{ xs: 1, md: 2, lg: 2, xl: 2, xxl: 2 }}>
			<Descriptions.Item label="Version">{host.version}</Descriptions.Item>
			<Descriptions.Item label="Node.js">{system?.node}</Descriptions.Item>
			<Descriptions.Item label="OS Kernel">{system?.kernel}</Descriptions.Item>
			<Descriptions.Item label="Machine">{system?.machine}</Descriptions.Item>
			<Descriptions.Item label="System Uptime">
				<MetricRelativeDate timeMs={system?.systemStartedAtMs}/>
			</Descriptions.Item>
			<Descriptions.Item label="Process Uptime">
				<MetricRelativeDate timeMs={system?.processStartedAtMs}/>
			</Descriptions.Item>
			<Descriptions.Item label="Hostname">{system?.hostname}</Descriptions.Item>
			<Descriptions.Item label="Connected From">{host.remoteAddress}</Descriptions.Item>
			<Descriptions.Item label="CPU Model" span={2}>{system?.cpuModel}</Descriptions.Item>
			<Descriptions.Item label="CPU Usage"><MetricCpuRatio system={system} /></Descriptions.Item>
			<Descriptions.Item label="Cores"><MetricCpuUsed system={system} /></Descriptions.Item>
			<Descriptions.Item label="Memory Usage"><MetricMemoryRatio system={system} /></Descriptions.Item>
			<Descriptions.Item label="Memory"><MetricMemoryUsed system={system} /></Descriptions.Item>
			<Descriptions.Item label="Disk Usage"><MetricDiskRatio system={system} /></Descriptions.Item>
			<Descriptions.Item label="Disk"><MetricDiskUsed system={system} /></Descriptions.Item>
			<Descriptions.Item label="Public Address">{host.publicAddress}</Descriptions.Item>
		</Descriptions>
		<ResourceNotes resourceType="host" resourceId={hostId} />
		{account.hasPermission("core.instance.list") && <>
			<Title level={5} style={{ marginTop: 16 }}>Instances</Title>
			<InstanceList instances={hostInstances} size="small" hideAssignedHost />
		</>}
		{account.hasPermission("core.log.follow") && <>
			<Flex justify="space-between" align="baseline">
				<Title level={5} style={{ marginTop: 16 }}>Console</Title>
				<SelectMaxLogLevel
					value={maxLevel}
					onChange={setMaxLevel}
					hidden={["server", "http"]}
				/>
			</Flex>
			<LogConsole hosts={[hostId]} maxLevel={maxLevel}/>
		</>}
		{account.hasPermission("core.host.get_config") && <HostConfigTree id={hostId} available={host.connected} />}
		<PluginExtra component="HostViewPage" host={host} />
	</PageLayout>;
}
