import React, { useContext, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import { Alert, Button, Descriptions, Dropdown, Menu, Modal, PageHeader, Space, Spin, Typography } from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";
import DownOutlined from "@ant-design/icons/DownOutlined";

import { libData } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import InstanceConfigTree from "./InstanceConfigTree";
import LogConsole from "./LogConsole";
import InstanceRcon from "./InstanceRcon";
import AssignInstanceModal from "./AssignInstanceModal";
import StartStopInstanceButton from "./StartStopInstanceButton";
import LoadScenarioModal from "./LoadScenarioModal";
import SavesList from "./SavesList";
import { notifyErrorHandler } from "../util/notify";
import { useInstance } from "../model/instance";
import { useHost } from "../model/host";
import InstanceStatusTag from "./InstanceStatusTag";

const { Title } = Typography;


function InstanceDescription(props) {
	let account = useAccount();

	const { host, instance } = props;
	let assigned = instance.assignedHost !== null;
	return <Descriptions
		bordered
		size="small"
	>
		<Descriptions.Item label="Host">
			{!assigned
				? <em>Unassigned</em>
				: host.name || instance.assignedHost
			}
			{account.hasPermission("core.instance.assign") && <AssignInstanceModal
				id={instance.id}
				hostId={instance.assignedHost}
				buttonProps={{
					size: "small",
					style: { float: "Right" },
					type: assigned ? "default" : "primary",
					disabled: !["unknown", "unassigned", "stopped"].includes(instance.status),
				}}
				buttonContent={assigned ? "Reassign" : "Assign"}
			/>}
		</Descriptions.Item>
		<Descriptions.Item label="Status"><InstanceStatusTag status={instance.status} /></Descriptions.Item>
	</Descriptions>;
}

export default function InstanceViewPage(props) {
	let params = useParams();
	let instanceId = Number(params.id);

	let history = useHistory();

	let account = useAccount();
	let control = useContext(ControlContext);
	let [instance] = useInstance(instanceId);
	let [host] = useHost(Number(instance.assignedHost));

	let [exportingData, setExportingData] = useState(false);

	let nav = [{ name: "Instances", path: "/instances" }, { name: instance.name || "Unknown" }];
	if (instance.loading) {
		return <PageLayout nav={nav}><Spin size="large" /></PageLayout>;
	}

	if (instance.missing || instance.status === "deleted") {
		return <PageLayout nav={nav}>
			<Alert
				message={instance.status === "deleted" ? "Instance has been deleted" : "Instance not found" }
				showIcon
				description={<>Instance with id {instanceId} was not found on the controller.</>}
				type="warning"
				action={
					<Button
						type="text"
						onClick={() => { history.push("/instances"); }}
					>
						Go back to instances list
					</Button>
				}
			/>
		</PageLayout>;
	}

	let instanceButtonMenuItems = [];
	if (account.hasPermission("core.instance.export_data")) {
		instanceButtonMenuItems.push({
			disabled: exportingData || instance.status !== "stopped",
			key: "export",
			label: "Export data",
		});
	}
	if (account.hasPermission("core.instance.extract_players")) {
		instanceButtonMenuItems.push({
			disabled: instance.status !== "running",
			key: "extract",
			label: "Extract players from save",
		});
	}
	if (account.hasPermission("core.instance.kill")) {
		instanceButtonMenuItems.push({
			disabled: ["unknown", "unassigned", "stopped"].includes(instance.status),
			key: "kill",
			label: "Kill process",
		});
	}
	if (account.hasPermission("core.instance.delete")) {
		if (instanceButtonMenuItems.length) {
			instanceButtonMenuItems.push({ type: "divider" });
		}
		instanceButtonMenuItems.push({
			disabled: !["unknown", "unassigned", "stopped"].includes(instance.status),
			danger: true,
			key: "delete",
			icon: <DeleteOutlined />,
			label: "Delete",
		});
	}
	let instanceButtonsMenu = <Menu
		items={instanceButtonMenuItems}
		onClick={({ key }) => {
			if (key === "export") {
				setExportingData(true);
				control.sendTo(
					new libData.InstanceExportDataRequest(), { instanceId }
				).catch(
					notifyErrorHandler("Error exporting data")
				).finally(() => {
					setExportingData(false);
				});

			} else if (key === "extract") {
				control.sendTo(
					new libData.InstanceExtractPlayersRequest(), { instanceId }
				).catch(notifyErrorHandler("Error extracting player data"));

			} else if (key === "kill") {
				control.sendTo(
					new libData.InstanceKillRequest(), { instanceId }
				).catch(notifyErrorHandler("Error killing instance"));

			} else if (key === "delete") {
				Modal.confirm({
					autoFocusButton: "cancel",
					content: "Permamently delete instance and server saves?",
					okText: "Delete",
					okButtonProps: { danger: true },
					onOk: () => {
						control.send(
							new libData.InstanceDeleteRequest(instanceId)
						).then(() => {
							history.push("/instances");
						}).catch(notifyErrorHandler("Error deleting instance"));
					},
				});
			}
		}}
	/>;
	let instanceButtons = <Space>
		{
			account.hasAnyPermission("core.instance.start", "core.instance.stop")
			&& <StartStopInstanceButton instance={instance} />
		}
		{account.hasPermission("core.instance.load_scenario") && <LoadScenarioModal instance={instance} />}
		{account.hasAnyPermission(
			"core.instance.export_data",
			"core.instance.extract_players",
			"core.instance.kill",
			"core.instance.delete",
		) && <Dropdown placement="bottomRight" trigger={["click"]} overlay={instanceButtonsMenu}>
			<Button>More <DownOutlined /></Button>
		</Dropdown>}
	</Space>;

	return <PageLayout nav={nav}>
		<PageHeader
			className="site-page-header"
			title={instance.name}
			extra={instanceButtons}
		/>
		<InstanceDescription host={host} instance={instance} />

		{
			account.hasAllPermission("core.instance.save.list", "core.instance.save.list_subscribe")
			&& <SavesList instance={instance} />
		}
		{
			account.hasAnyPermission("core.log.follow", "core.instance.send_rcon")
			&& <Title level={5} style={{ marginTop: 16 }}>Console</Title>
		}
		{account.hasPermission("core.log.follow") && <LogConsole instances={[instanceId]} />}
		{
			account.hasPermission("core.instance.send_rcon")
			&& <InstanceRcon id={instanceId} disabled={instance.status !== "running"} />
		}

		{account.hasPermission("core.instance.get_config") && <InstanceConfigTree id={instanceId} />}

		<PluginExtra component="InstanceViewPage" instance={instance} />
	</PageLayout>;
}
