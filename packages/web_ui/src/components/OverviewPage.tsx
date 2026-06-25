import React, { useContext, useEffect, useState } from "react";
import { Row, Col, Card, Statistic, Progress, Button, Typography } from "antd";
import { LineChartOutlined } from "@ant-design/icons";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useHosts } from "../model/host";
import { useInstances } from "../model/instance";
import { useUsers, isUserOnline } from "../model/user";
import { useSystems } from "../model/system";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import LogConsole from "./LogConsole";
import { MetricRelativeDate } from "./system_metrics";

const { Title } = Typography;

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** A resource card showing used / total with a usage bar. */
function ResourceCard(
	props: { title: string, used: number, total: number, format: (n: number) => string, unit?: string }
) {
	const percent = props.total > 0 ? Math.round((props.used / props.total) * 100) : 0;
	const suffix = `/ ${props.format(props.total)}${props.unit ? ` ${props.unit}` : ""}`;
	return <Card>
		<Statistic title={props.title} value={props.format(props.used)} suffix={suffix} />
		<Progress percent={percent} size="small" />
	</Card>;
}

/** Format a core count: a fraction for partial use, a whole number for the total. */
const formatCores = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

export default function OverviewPage() {
	const account = useAccount();
	const control = useContext(ControlContext);
	const [hosts] = useHosts();
	const [instances] = useInstances();
	const [users] = useUsers();
	const [systems] = useSystems();
	const [grafanaUrl, setGrafanaUrl] = useState<string | null>(null);

	const canHosts = account.hasPermission("core.host.list");
	const canInstances = account.hasPermission("core.instance.list");
	const canUsers = account.hasPermission("core.user.list");
	const canLogs = account.hasPermission("core.log.follow");
	const canConfig = account.hasPermission("core.controller.get_config");

	useEffect(() => {
		if (!canConfig) {
			return undefined;
		}
		let canceled = false;
		control.send(new lib.ControllerConfigGetRequest()).then(serialized => {
			if (canceled) {
				return;
			}
			const config = lib.ControllerConfig.fromJSON(serialized, "control");
			const url = config.get("controller.grafana_url");
			setGrafanaUrl(typeof url === "string" ? url : null);
		}).catch(() => { /* link stays hidden if the config can't be read */ });
		return () => { canceled = true; };
	}, [control, canConfig]);

	const hostList = [...hosts.values()];
	const instanceList = [...instances.values()];
	const userList = [...users.values()];
	// Resource totals across the connected host machines (the controller is shown only for uptime).
	const hostSystems = [...systems.values()].filter(system => system.id !== "controller");
	const controllerSystem = systems.get("controller");

	const colProps = { xs: 24, sm: 12, lg: 8 };

	return <PageLayout nav={[{ name: "Overview" }]}>
		<PageHeader
			title="Overview"
			extra={grafanaUrl
				? <Button icon={<LineChartOutlined />} href={grafanaUrl} target="_blank" rel="noreferrer">
					Grafana
				</Button>
				: undefined}
		/>
		<Row gutter={[16, 16]}>
			{canHosts && <Col {...colProps}>
				<Card>
					<Statistic title="Hosts connected" value={hostList.filter(h => h.connected).length}
						suffix={`/ ${hostList.length}`} />
				</Card>
			</Col>}
			{canInstances && <Col {...colProps}>
				<Card>
					<Statistic title="Instances running" value={instanceList.filter(i => i.status === "running").length}
						suffix={`/ ${instanceList.length}`} />
				</Card>
			</Col>}
			{canUsers && <Col {...colProps}>
				<Card>
					<Statistic title="Users online" value={userList.filter(u => isUserOnline(u)).length}
						suffix={`/ ${userList.length}`} />
				</Card>
			</Col>}
			{canHosts && <>
				<Col {...colProps}>
					<ResourceCard title="CPU" used={sum(hostSystems.map(s => s.cpuUsed))}
						total={sum(hostSystems.map(s => s.cpuCapacity))} format={formatCores} unit="cores" />
				</Col>
				<Col {...colProps}>
					<ResourceCard title="Memory" used={sum(hostSystems.map(s => s.memoryUsed))}
						total={sum(hostSystems.map(s => s.memoryCapacity))} format={lib.formatBytes} />
				</Col>
				<Col {...colProps}>
					<ResourceCard title="Disk" used={sum(hostSystems.map(s => s.diskUsed))}
						total={sum(hostSystems.map(s => s.diskCapacity))} format={lib.formatBytes} />
				</Col>
				<Col {...colProps}>
					<Card>
						<Statistic title="Controller running since"
							formatter={() => <MetricRelativeDate timeMs={controllerSystem?.processStartedAtMs} />} />
					</Card>
				</Col>
			</>}
		</Row>
		{canLogs && <>
			<Title level={5} style={{ marginTop: 16 }}>Recent errors</Title>
			<LogConsole all maxLevel="warn" />
		</>}
		<PluginExtra component="OverviewPage" />
	</PageLayout>;
}
