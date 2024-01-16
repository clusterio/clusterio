import React, { useContext } from "react";
import { Descriptions, Spin, Tag, Typography, Button, Space, Modal, Popconfirm } from "antd";
import { useParams } from "react-router-dom";

import * as lib from "@clusterio/lib";
import notify, { notifyErrorHandler } from "../util/notify";
import ControlContext from "./ControlContext";
import HostConfigTree from "./HostConfigTree";
import InstanceList from "./InstanceList";
import LogConsole from "./LogConsole";
import { useAccount } from "../model/account";
import { useInstances } from "../model/instance";
import { useHost } from "../model/host";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import {
	MetricCpuRatio, MetricCpuUsed, MetricMemoryRatio, MetricMemoryUsed,
	MetricDiskUsed, MetricDiskRatio,
} from "./system_metrics";
import { formatTimestamp } from "../util/time_format";
import { useSystemMetrics } from "../model/system_metrics";

const { Title } = Typography;

export default function HostViewPage() {
	let params = useParams();
	let hostId = Number(params.id);
	let control = useContext(ControlContext);
	let account = useAccount();
	let [instances] = useInstances();
	const [systemMetrics] = useSystemMetrics();
	const metrics = systemMetrics.get(hostId);
	const [host, synced] = useHost(hostId);
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

	let hostButtons = <Space> {
		account.hasPermission("core.host.revoke_access")
			&& <Popconfirm
				title={`Revoke tokens of ${host.name}?`}
				placement="bottomRight"
				okText="Revoke Tokens"
				okButtonProps={{ danger: true }}
				onConfirm={() => {
					control.send(new lib.HostRevokeTokensRequest(host.id!))
						.then(() => notify("Host tokens revoked"))
						.catch(notifyErrorHandler(`Error revoking tokens for host id:${host.id}`));
				}}
			>
				<Button danger>
					Revoke tokens
				</Button>
			</Popconfirm>
	}
	</Space>;

	return <PageLayout nav={nav}>
		<PageHeader
			title={host.name || String(hostId)}
			extra={hostButtons}
		/>
		<Descriptions bordered size="small" column={{ xs: 1, md: 2, lg: 2, xl: 2, xxl: 2 }}>
			<Descriptions.Item label="Name">{host["name"]}</Descriptions.Item>
			<Descriptions.Item label="Connected">
				<Tag color={host["connected"] ? "#389e0d" : "#cf1322"}>
					{host["connected"] ? "Connected" : "Disconnected"}
				</Tag>
			</Descriptions.Item>
			<Descriptions.Item label="CPU Usage"><MetricCpuRatio metrics={metrics} /></Descriptions.Item>
			<Descriptions.Item label="Cores"><MetricCpuUsed metrics={metrics} /></Descriptions.Item>
			<Descriptions.Item label="Memory Usage"><MetricMemoryRatio metrics={metrics} /></Descriptions.Item>
			<Descriptions.Item label="Memory"><MetricMemoryUsed metrics={metrics} /></Descriptions.Item>
			<Descriptions.Item label="Disk Usage"><MetricDiskRatio metrics={metrics} /></Descriptions.Item>
			<Descriptions.Item label="Disk"><MetricDiskUsed metrics={metrics} /></Descriptions.Item>
			<Descriptions.Item label="Version">{host["version"]}</Descriptions.Item>
			{
				host.tokenValidAfter
					? <Descriptions.Item label="Tokens valid after:">
						{formatTimestamp(host.tokenValidAfter*1000)}
					</Descriptions.Item>
					: null
			}
		</Descriptions>
		{account.hasPermission("core.instance.list") && <>
			<Title level={5} style={{ marginTop: 16 }}>Instances</Title>
			<InstanceList instances={hostInstances} size="small" hideAssignedHost />
		</>}
		{account.hasPermission("core.log.follow") && <>
			<Title level={5} style={{ marginTop: 16 }}>Console</Title>
			<LogConsole hosts={[hostId]} />
		</>}
		{account.hasPermission("core.host.get_config") && <HostConfigTree id={hostId} available={host.connected} />}
		<PluginExtra component="HostViewPage" host={host} />
	</PageLayout>;
}
