import React, {useContext} from "react";
import { Button, Descriptions, Popconfirm, Space, Typography } from "antd";

import * as lib from "@clusterio/lib";

import PluginExtra from "./PluginExtra";
import LogConsole from "./LogConsole";
import {
	MetricCpuRatio, MetricCpuUsed, MetricMemoryRatio, MetricMemoryUsed,
	MetricDiskUsed, MetricDiskRatio,
} from "./system_metrics";
import { useAccount } from "../model/account";
import { useSystems } from "../model/system";
import ControlContext from "./ControlContext";
import ControllerConfigTree from "./ControllerConfigTree";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import { notifyErrorHandler } from "../util/notify";
import webUiPackage from "../../package.json";

const { Title } = Typography;


export default function ControllerPage() {
	let account = useAccount();
	const control = useContext(ControlContext);
	const [systems] = useSystems();
	const system = systems.get("controller");

	return <PageLayout nav={[{ name: "Controller" }]}>
		<PageHeader
			title="Controller"
			extra={<Space>
				{
					account.hasPermission("core.controller.stop")
					&& <Popconfirm
						title={<>
							Stopping the controller will leave the cluster inoperable until someone with
							access to the system it runs on manually starts it again.<br />
							Are you sure you want to stop the controller?
						</>}
						placement="bottomRight"
						okText="Stop"
						okButtonProps={{ danger: true }}
						onConfirm={() => {
							control.send(
								new lib.ControllerStopRequest()
							).catch(notifyErrorHandler("Error stopping controller"));
						}}
					>
						<Button danger>Stop</Button>
					</Popconfirm>
				}
				{
					account.hasPermission("core.controller.restart")
					&& <Button
						disabled={system?.canRestart === false}
						onClick={() => {
							control.send(
								new lib.ControllerRestartRequest()
							).catch(notifyErrorHandler("Error restarting controller"));
						}}
					>
						Restart
					</Button>
				}
			</Space>}
		/>

		<Descriptions bordered size="small" column={{ xs: 1, md: 2, lg: 2, xl: 2, xxl: 2 }}>
			<Descriptions.Item label="Version">{webUiPackage.version}</Descriptions.Item>
			<Descriptions.Item label="Node.js">{system?.node}</Descriptions.Item>
			<Descriptions.Item label="OS Kernel">{system?.kernel}</Descriptions.Item>
			<Descriptions.Item label="Machine">{system?.machine}</Descriptions.Item>
			<Descriptions.Item label="Hostname" span={2}>{system?.hostname}</Descriptions.Item>
			<Descriptions.Item label="CPU Model" span={2}>{system?.cpuModel}</Descriptions.Item>
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
