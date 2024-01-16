import React from "react";
import { Descriptions, Typography } from "antd";

import PluginExtra from "./PluginExtra";
import LogConsole from "./LogConsole";
import {
	MetricCpuRatio, MetricCpuUsed, MetricMemoryRatio, MetricMemoryUsed,
	MetricDiskUsed, MetricDiskRatio,
} from "./system_metrics";
import { useAccount } from "../model/account";
import { useSystems } from "../model/system";
import ControllerConfigTree from "./ControllerConfigTree";
import PageLayout from "./PageLayout";

const { Title } = Typography;


export default function ControllerPage() {
	let account = useAccount();
	const [systems] = useSystems();
	const system = systems.get("controller");

	return <PageLayout nav={[{ name: "Controller" }]}>
		<h2>Controller</h2>
		<Descriptions bordered size="small" column={{ xs: 1, md: 2, lg: 2, xl: 2, xxl: 2 }}>
			<Descriptions.Item label="CPU Usage"><MetricCpuRatio system={system} /></Descriptions.Item>
			<Descriptions.Item label="Cores"><MetricCpuUsed system={system} /></Descriptions.Item>
			<Descriptions.Item label="Memory Usage"><MetricMemoryRatio system={system} /></Descriptions.Item>
			<Descriptions.Item label="Memory"><MetricMemoryUsed system={system} /></Descriptions.Item>
			<Descriptions.Item label="Disk Usage"><MetricDiskRatio system={system} /></Descriptions.Item>
			<Descriptions.Item label="Disk"><MetricDiskUsed system={system} /></Descriptions.Item>
		</Descriptions>
		{account.hasPermission("core.log.follow") && <>
			<Title level={5} style={{ marginTop: 16 }}>Console</Title>
			<LogConsole controller={true} />
		</>}
		{account.hasPermission("core.controller.get_config") && <ControllerConfigTree />}
		<PluginExtra component="ControllerPage" />
	</PageLayout>;
};
