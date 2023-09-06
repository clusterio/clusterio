import React, { useContext } from "react";
import { Descriptions, Spin, Tag, Typography, Button, Space, Modal, Popconfirm } from "antd";
import { useParams } from "react-router-dom";

import * as lib from "@clusterio/lib";
import { notifyErrorHandler } from "../util/notify";
import type { Control } from "../util/websocket";
import ControlContext from "./ControlContext";
import InstanceList from "./InstanceList";
import LogConsole from "./LogConsole";
import { useAccount } from "../model/account";
import { useInstanceList } from "../model/instance";
import { HostState, useHost } from "../model/host";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { formatTimestamp } from "../util/time_format";

const { Title } = Typography;

export default function HostViewPage() {
	let params = useParams();
	let hostId = Number(params.id);
	let control = useContext(ControlContext);
	let account = useAccount();
	let [instanceList] = useInstanceList();
	let [host] = useHost(hostId);

	instanceList = instanceList.filter(instance => instance.assignedHost === hostId);

	let nav = [{ name: "Hosts", path: "/hosts" }, { name: host.name || String(hostId) }];
	if (host.loading) {
		return <PageLayout nav={nav}><Spin size="large" /></PageLayout>;
	}

	if (host.missing) {
		return <PageLayout nav={nav}>
			<PageHeader title={String(hostId)} />
			<p>Host with id {hostId} was not found on the controller.</p>
		</PageLayout>;
	}

	let hostButtons = <Space> {
			account.hasAnyPermission("core.host.revoke_access", "core.admin")
			&& (
				host.accessRevokedAt === undefined ?
				<Popconfirm
					title={`Revoke access of ${host.name}?`}
					placement="bottomRight"
					okText="Revoke Access"
					okButtonProps={{ danger: true }}
					onConfirm={() => updateAccess("revoke", host, control)}
				>
					<Button danger>
						Revoke Access
					</Button>
				</Popconfirm> :
				<Popconfirm
					title={`Restore access of ${host.name}?`}
					placement="bottomRight"
					okText="Restore Access"
					onConfirm={() => updateAccess("restore", host, control)}
				>
					<Button danger>
					Restore Access
					</Button>
				</Popconfirm>
			)
		}
	</Space>

	return <PageLayout nav={nav}>
		<PageHeader
			title={host.name || String(hostId)}
			extra={hostButtons}
		/>
		<Descriptions bordered size="small" column={{ xs: 1, sm: 2, xl: 4 }}>
			<Descriptions.Item label="Name">{host["name"]}</Descriptions.Item>
			<Descriptions.Item label="Connected">
				<Tag color={host["connected"] ? "#389e0d" : "#cf1322"}>
					{host["connected"] ? "Connected" : "Disconnected"}
				</Tag>
			</Descriptions.Item>
			<Descriptions.Item label="Agent">{host["agent"]}</Descriptions.Item>
			<Descriptions.Item label="Version">{host["version"]}</Descriptions.Item>
			<Descriptions.Item label="Access">
				{
					host.accessRevokedAt ?
					<Tag color="#cf1322">
						Revoked at {formatTimestamp(host.accessRevokedAt)}
					</Tag> :
					"Granted"
				}
			</Descriptions.Item>
		</Descriptions>
		{account.hasPermission("core.instance.list") && <>
			<Title level={5} style={{ marginTop: 16 }}>Instances</Title>
			<InstanceList instances={instanceList} size="small" hideAssignedHost />
		</>}
		{account.hasPermission("core.log.follow") && <>
			<Title level={5} style={{ marginTop: 16 }}>Console</Title>
			<LogConsole hosts={[hostId]} />
		</>}
		<PluginExtra component="HostViewPage" host={host} />
	</PageLayout>;
}

function updateAccess(status: "revoke"|"restore", host: HostState, control: Control) {
		control.send(new lib.HostAccessUpdateRequest(host.id!, status))
			.catch(notifyErrorHandler(`Error updating host id:${host.id} access`))
}
