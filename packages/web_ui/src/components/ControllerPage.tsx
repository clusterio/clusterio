import React from "react";
import { Descriptions, Typography } from "antd";

import PluginExtra from "./PluginExtra";
import LogConsole from "./LogConsole";
import {
	MetricCpuRatio, MetricCpuUsed, MetricMemoryRatio, MetricMemoryUsed,
	MetricDiskUsed, MetricDiskRatio,
} from "./system_metrics";
import { useAccount } from "../model/account";
import { useSystemMetrics } from "../model/system_metrics";
import ControllerConfigTree from "./ControllerConfigTree";
import PageLayout from "./PageLayout";

const { Title } = Typography;


export default function ControllerPage() {
	let account = useAccount();
	const [systemMetrics] = useSystemMetrics();
	const metrics = systemMetrics.get("controller");

	return <PageLayout nav={[{ name: "Controller" }]}>
		<h2>Controller</h2>
		<Descriptions bordered size="small" column={{ xs: 1, md: 2, lg: 2, xl: 2, xxl: 2 }}>
			<Descriptions.Item label="CPU Usage"><MetricCpuRatio metrics={metrics} /></Descriptions.Item>
			<Descriptions.Item label="Cores"><MetricCpuUsed metrics={metrics} /></Descriptions.Item>
			<Descriptions.Item label="Memory Usage"><MetricMemoryRatio metrics={metrics} /></Descriptions.Item>
			<Descriptions.Item label="Memory"><MetricMemoryUsed metrics={metrics} /></Descriptions.Item>
			<Descriptions.Item label="Disk Usage"><MetricDiskRatio metrics={metrics} /></Descriptions.Item>
			<Descriptions.Item label="Disk"><MetricDiskUsed metrics={metrics} /></Descriptions.Item>
		</Descriptions>
		{account.hasPermission("core.log.follow") && <>
			<Title level={5} style={{ marginTop: 16 }}>Console</Title>
			<LogConsole controller={true} />
		</>}
		{account.hasPermission("core.controller.get_config") && <ControllerConfigTree />}
		<PluginExtra component="ControllerPage" />
	</PageLayout>;
};
