import React from "react";
import { Descriptions, PageHeader, Spin, Tag, Typography } from "antd";
import { useParams } from "react-router-dom";

import InstanceList from "./InstanceList";
import LogConsole from "./LogConsole";
import { useAccount } from "../model/account";
import { useInstanceList } from "../model/instance";
import { useSlave } from "../model/slave";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";

const { Title } = Typography;


export default function SlaveViewPage(props) {
	let params = useParams();
	let slaveId = Number(params.id);
	let account = useAccount();
	let [instanceList] = useInstanceList();
	let [slave] = useSlave(slaveId);

	instanceList = instanceList.filter(instance => instance["assigned_slave"] === slaveId);

	let nav = [{ name: "Slaves", path: "/slaves" }, { name: slave.name || slaveId }];
	if (slave.loading) {
		return <PageLayout nav={nav}><Spin size="large" /></PageLayout>;
	}

	if (slave.missing) {
		return <PageLayout nav={nav}>
			<PageHeader
				className="site-page-header"
				title={slaveId}
			/>
			<p>Slave with id {slaveId} was not found on the controller.</p>
		</PageLayout>;
	}

	return <PageLayout nav={nav}>
		<PageHeader
			className="site-page-header"
			title={slave.name || slaveId}
		/>

		<Descriptions bordered size="small" column={{ xs: 1, sm: 2, xl: 4 }}>
			<Descriptions.Item label="Name">{slave["name"]}</Descriptions.Item>
			<Descriptions.Item label="Connected">
				<Tag color={slave["connected"] ? "#389e0d" : "#cf1322"}>
					{slave["connected"] ? "Connected" : "Disconnected"}
				</Tag>
			</Descriptions.Item>
			<Descriptions.Item label="Agent">{slave["agent"]}</Descriptions.Item>
			<Descriptions.Item label="Version">{slave["version"]}</Descriptions.Item>
		</Descriptions>
		{account.hasPermission("core.instance.list") && <>
			<Title level={5} style={{ marginTop: 16 }}>Instances</Title>
			<InstanceList instances={instanceList} size="small" hideAssignedSlave />
		</>}
		{account.hasPermission("core.log.follow") && <>
			<Title level={5} style={{ marginTop: 16 }}>Console</Title>
			<LogConsole slaves={[slaveId]} />
		</>}
		<PluginExtra component="SlaveViewPage" slave={slave} />
	</PageLayout>;
}
