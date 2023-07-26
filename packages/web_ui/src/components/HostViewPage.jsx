import React from "react";
import { Descriptions, PageHeader, Spin, Tag, Typography } from "antd";
import { useParams } from "react-router-dom";

import InstanceList from "./InstanceList";
import LogConsole from "./LogConsole";
import { useAccount } from "../model/account";
import { useInstanceList } from "../model/instance";
import { useHost } from "../model/host";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";

const { Title } = Typography;


export default function HostViewPage(props) {
	let params = useParams();
	let hostId = Number(params.id);
	let account = useAccount();
	let [instanceList] = useInstanceList();
	let [host] = useHost(hostId);

	instanceList = instanceList.filter(instance => instance.assignedHost === hostId);

	let nav = [{ name: "Hosts", path: "/hosts" }, { name: host.name || hostId }];
	if (host.loading) {
		return <PageLayout nav={nav}><Spin size="large" /></PageLayout>;
	}

	if (host.missing) {
		return <PageLayout nav={nav}>
			<PageHeader
				className="site-page-header"
				title={hostId}
			/>
			<p>Host with id {hostId} was not found on the controller.</p>
		</PageLayout>;
	}

	return <PageLayout nav={nav}>
		<PageHeader
			className="site-page-header"
			title={host.name || hostId}
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
